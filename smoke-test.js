const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dbPath = path.join(root, "smoke-test.sqlite");
const port = 3917;
const base = `http://127.0.0.1:${port}`;

let token = "";

function removeTestDatabase() {
  for (const suffix of ["", "-shm", "-wal"]) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

async function removeTestDatabaseWithRetry() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      removeTestDatabase();
      return;
    } catch (error) {
      if (error.code !== "EBUSY" && error.code !== "EPERM") throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

async function request(route, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${route}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${route} ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

function waitForServer(process) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server did not start in time.")), 8000);
    process.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Team Task Manager running")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    process.stderr.on("data", (chunk) => {
      const text = String(chunk);
      if (!text.includes("ExperimentalWarning")) process.stderr.write(text);
    });
    process.on("exit", (code) => {
      reject(new Error(`Server exited early with code ${code}.`));
    });
  });
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  await new Promise((resolve) => {
    const fallback = setTimeout(resolve, 2500);
    server.once("exit", () => {
      clearTimeout(fallback);
      resolve();
    });
    server.kill("SIGTERM");
  });
}

async function main() {
  removeTestDatabase();
  const server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForServer(server);
    const page = await fetch(`${base}/`).then((response) => response.text());
    if (!page.includes("Team Task Manager")) throw new Error("Static app shell did not load.");

    const login = await request("/api/auth/login", {
      method: "POST",
      body: { email: "admin@taskflow.test", password: "Admin123!" }
    });
    token = login.token;

    const dashboard = await request("/api/dashboard");
    const projects = await request("/api/projects");
    if (!projects.projects.length) throw new Error("Expected seeded project.");

    const projectId = projects.projects[0].id;
    const project = await request(`/api/projects/${projectId}`);
    const member = project.project.members.find((item) => item.role === "Member");
    if (!member) throw new Error("Expected seeded project member.");

    const task = await request(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      body: {
        title: "Smoke test task",
        description: "Created by automated smoke test.",
        assigneeId: member.id,
        status: "Todo",
        priority: "Low",
        dueDate: null
      }
    });
    await request(`/api/tasks/${task.task.id}`, {
      method: "PATCH",
      body: { status: "Done" }
    });

    token = "";
    const memberLogin = await request("/api/auth/login", {
      method: "POST",
      body: { email: "member@taskflow.test", password: "Member123!" }
    });
    token = memberLogin.token;

    let denied = false;
    try {
      await request("/api/projects", {
        method: "POST",
        body: { name: "Blocked Project", description: "Should fail", status: "Active" }
      });
    } catch (error) {
      denied = error.message.includes("403");
    }
    if (!denied) throw new Error("Expected member project creation to be denied.");

    console.log(JSON.stringify({
      auth: login.user.email,
      projects: projects.projects.length,
      seededTasks: project.project.tasks.length,
      createdTask: task.task.title,
      dashboard: dashboard.stats,
      rbac: "member create denied"
    }, null, 2));
  } finally {
    await stopServer(server);
    await removeTestDatabaseWithRetry();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
