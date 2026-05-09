const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "task-manager.sqlite");
const PUBLIC_DIR = path.join(__dirname, "public");
const TOKEN_SECRET =
  process.env.TOKEN_SECRET || "dev-task-manager-secret-change-for-production";
const TOKEN_TTL_SECONDS = 60 * 60 * 8;

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

const staticTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('Admin', 'Member')) DEFAULT 'Member',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('Planning', 'Active', 'Completed')) DEFAULT 'Active',
      due_date TEXT,
      owner_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('Admin', 'Member')) DEFAULT 'Member',
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, user_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      assignee_id INTEGER,
      creator_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('Todo', 'In Progress', 'Review', 'Done')) DEFAULT 'Todo',
      priority TEXT NOT NULL CHECK (priority IN ('Low', 'Medium', 'High')) DEFAULT 'Medium',
      due_date TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_project_members_user
      ON project_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project
      ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee
      ON tasks(assignee_id);
  `);
}

function seed() {
  const count = db.prepare("SELECT COUNT(*) AS total FROM users").get().total;
  if (count > 0) return;

  const admin = createUserRecord("Aarav Sharma", "admin@taskflow.test", "Admin123!", "Admin");
  const member = createUserRecord("Maya Rao", "member@taskflow.test", "Member123!", "Member");

  const projectId = insertProject({
    name: "Website Redesign",
    description: "Refresh the marketing site, content system, and launch checklist.",
    status: "Active",
    dueDate: addDays(21),
    ownerId: admin.id
  });

  addProjectMember(projectId, admin.id, "Admin");
  addProjectMember(projectId, member.id, "Member");

  insertTask({
    projectId,
    title: "Audit landing pages",
    description: "List priority pages, missing metadata, and outdated sections.",
    assigneeId: member.id,
    creatorId: admin.id,
    status: "In Progress",
    priority: "High",
    dueDate: addDays(3)
  });
  insertTask({
    projectId,
    title: "Approve design tokens",
    description: "Confirm typography, spacing, status colors, and component tokens.",
    assigneeId: admin.id,
    creatorId: admin.id,
    status: "Review",
    priority: "Medium",
    dueDate: addDays(6)
  });
  insertTask({
    projectId,
    title: "Publish launch checklist",
    description: "Create the QA and deployment owner checklist.",
    assigneeId: null,
    creatorId: admin.id,
    status: "Todo",
    priority: "Medium",
    dueDate: addDays(-2)
  });
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const candidate = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

function signToken(user) {
  const payload = {
    sub: user.id,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

function readToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, signature] = token.split(".");
  const expected = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(body)
    .digest("base64url");
  const valid =
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function createUserRecord(name, email, password, role = "Member") {
  const normalizedEmail = email.toLowerCase().trim();
  const info = db
    .prepare(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)"
    )
    .run(name.trim(), normalizedEmail, hashPassword(password), role);
  return getUserById(Number(info.lastInsertRowid));
}

function getUserById(id) {
  return db
    .prepare(
      "SELECT id, name, email, role, created_at AS createdAt FROM users WHERE id = ?"
    )
    .get(id);
}

function getUserByEmail(email) {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.toLowerCase().trim());
}

function insertProject({ name, description, status, dueDate, ownerId }) {
  const info = db
    .prepare(
      `INSERT INTO projects (name, description, status, due_date, owner_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(name.trim(), cleanText(description), status, emptyToNull(dueDate), ownerId);
  return Number(info.lastInsertRowid);
}

function addProjectMember(projectId, userId, role) {
  db.prepare(
    `INSERT INTO project_members (project_id, user_id, role)
     VALUES (?, ?, ?)
     ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`
  ).run(projectId, userId, role);
}

function insertTask({
  projectId,
  title,
  description,
  assigneeId,
  creatorId,
  status,
  priority,
  dueDate
}) {
  const info = db
    .prepare(
      `INSERT INTO tasks
       (project_id, title, description, assignee_id, creator_id, status, priority, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      projectId,
      title.trim(),
      cleanText(description),
      assigneeId || null,
      creatorId,
      status,
      priority,
      emptyToNull(dueDate)
    );
  return Number(info.lastInsertRowid);
}

function cleanText(value) {
  return String(value || "").trim();
}

function emptyToNull(value) {
  const text = cleanText(value);
  return text ? text : null;
}

function isValidDate(value) {
  if (!value) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function passwordErrors(password) {
  const errors = [];
  if (String(password || "").length < 8) errors.push("Password must be at least 8 characters.");
  if (!/[A-Z]/.test(password)) errors.push("Password must include an uppercase letter.");
  if (!/[0-9]/.test(password)) errors.push("Password must include a number.");
  return errors;
}

function sendJson(res, status, payload) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, details = undefined) {
  sendJson(res, status, { error: message, details });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8") || "{}";
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt || user.created_at
  };
}

function authenticate(req) {
  const header = req.headers.authorization || "";
  const [, token] = header.match(/^Bearer\s+(.+)$/i) || [];
  const payload = readToken(token);
  if (!payload) return null;
  return getUserById(payload.sub);
}

function requireAuth(req, res) {
  const user = authenticate(req);
  if (!user) {
    sendError(res, 401, "Please log in to continue.");
    return null;
  }
  return user;
}

function requireGlobalAdmin(user, res) {
  if (user.role !== "Admin") {
    sendError(res, 403, "Admin access is required for this action.");
    return false;
  }
  return true;
}

function projectRole(projectId, userId) {
  const row = db
    .prepare(
      `SELECT role FROM project_members
       WHERE project_id = ? AND user_id = ?`
    )
    .get(projectId, userId);
  return row?.role || null;
}

function canViewProject(projectId, user) {
  return user.role === "Admin" || Boolean(projectRole(projectId, user.id));
}

function canManageProject(projectId, user) {
  return user.role === "Admin" || projectRole(projectId, user.id) === "Admin";
}

function getProject(projectId) {
  return db
    .prepare(
      `SELECT
        p.id,
        p.name,
        p.description,
        p.status,
        p.due_date AS dueDate,
        p.owner_id AS ownerId,
        p.created_at AS createdAt,
        u.name AS ownerName
       FROM projects p
       JOIN users u ON u.id = p.owner_id
       WHERE p.id = ?`
    )
    .get(projectId);
}

function projectPayload(project, viewer) {
  const members = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role AS accountRole, pm.role, pm.joined_at AS joinedAt
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ?
       ORDER BY pm.role, u.name`
    )
    .all(project.id);
  const tasks = db
    .prepare(
      `SELECT
        t.id,
        t.project_id AS projectId,
        t.title,
        t.description,
        t.assignee_id AS assigneeId,
        assignee.name AS assigneeName,
        t.creator_id AS creatorId,
        creator.name AS creatorName,
        t.status,
        t.priority,
        t.due_date AS dueDate,
        t.created_at AS createdAt,
        t.updated_at AS updatedAt
       FROM tasks t
       LEFT JOIN users assignee ON assignee.id = t.assignee_id
       JOIN users creator ON creator.id = t.creator_id
       WHERE t.project_id = ?
       ORDER BY
        CASE t.status
          WHEN 'Todo' THEN 1
          WHEN 'In Progress' THEN 2
          WHEN 'Review' THEN 3
          WHEN 'Done' THEN 4
        END,
        COALESCE(t.due_date, '9999-12-31'),
        t.id DESC`
    )
    .all(project.id);
  return {
    ...project,
    viewerRole: viewer.role === "Admin" ? "Admin" : projectRole(project.id, viewer.id),
    members,
    tasks
  };
}

function listProjects(user) {
  if (user.role === "Admin") {
    return db
      .prepare(
        `SELECT
          p.id,
          p.name,
          p.description,
          p.status,
          p.due_date AS dueDate,
          p.owner_id AS ownerId,
          p.created_at AS createdAt,
          u.name AS ownerName,
          COUNT(DISTINCT pm.user_id) AS memberCount,
          COUNT(DISTINCT t.id) AS taskCount,
          COUNT(DISTINCT CASE WHEN t.status = 'Done' THEN t.id END) AS doneCount
         FROM projects p
         JOIN users u ON u.id = p.owner_id
         LEFT JOIN project_members pm ON pm.project_id = p.id
         LEFT JOIN tasks t ON t.project_id = p.id
         GROUP BY p.id
         ORDER BY p.created_at DESC`
      )
      .all();
  }

  return db
    .prepare(
      `SELECT
        p.id,
        p.name,
        p.description,
        p.status,
        p.due_date AS dueDate,
        p.owner_id AS ownerId,
        p.created_at AS createdAt,
        u.name AS ownerName,
        COUNT(DISTINCT pm2.user_id) AS memberCount,
        COUNT(DISTINCT t.id) AS taskCount,
        COUNT(DISTINCT CASE WHEN t.status = 'Done' THEN t.id END) AS doneCount
       FROM projects p
       JOIN users u ON u.id = p.owner_id
       JOIN project_members viewer ON viewer.project_id = p.id AND viewer.user_id = ?
       LEFT JOIN project_members pm2 ON pm2.project_id = p.id
       LEFT JOIN tasks t ON t.project_id = p.id
       GROUP BY p.id
       ORDER BY p.created_at DESC`
    )
    .all(user.id);
}

function dashboard(user) {
  const projectFilter =
    user.role === "Admin"
      ? ""
      : "JOIN project_members viewer ON viewer.project_id = p.id AND viewer.user_id = ?";
  const args = user.role === "Admin" ? [] : [user.id];
  const stats = db
    .prepare(
      `SELECT
        COUNT(DISTINCT p.id) AS projects,
        COUNT(t.id) AS tasks,
        SUM(CASE WHEN t.status = 'Done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN t.status != 'Done'
              AND t.due_date IS NOT NULL
              AND date(t.due_date) < date('now') THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN t.assignee_id = ? AND t.status != 'Done' THEN 1 ELSE 0 END) AS assignedOpen
       FROM projects p
       ${projectFilter}
       LEFT JOIN tasks t ON t.project_id = p.id`
    )
    .get(user.id, ...args);

  const byStatus = db
    .prepare(
      `SELECT t.status, COUNT(*) AS count
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       ${projectFilter}
       GROUP BY t.status`
    )
    .all(...args);

  const dueSoon = db
    .prepare(
      `SELECT
        t.id,
        t.title,
        t.status,
        t.priority,
        t.due_date AS dueDate,
        p.id AS projectId,
        p.name AS projectName,
        u.name AS assigneeName
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       ${projectFilter}
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.status != 'Done'
       ORDER BY
        CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
        t.due_date,
        CASE t.priority
          WHEN 'High' THEN 1
          WHEN 'Medium' THEN 2
          WHEN 'Low' THEN 3
        END
       LIMIT 8`
    )
    .all(...args);

  return {
    stats: {
      projects: Number(stats.projects || 0),
      tasks: Number(stats.tasks || 0),
      done: Number(stats.done || 0),
      overdue: Number(stats.overdue || 0),
      assignedOpen: Number(stats.assignedOpen || 0)
    },
    byStatus,
    dueSoon
  };
}

function validateProjectInput(body, partial = false) {
  const errors = [];
  const name = cleanText(body.name);
  const status = body.status || "Active";
  const dueDate = emptyToNull(body.dueDate);
  if (!partial || "name" in body) {
    if (name.length < 3) errors.push("Project name must be at least 3 characters.");
    if (name.length > 80) errors.push("Project name must be 80 characters or less.");
  }
  if (!["Planning", "Active", "Completed"].includes(status)) {
    errors.push("Project status is invalid.");
  }
  if (!isValidDate(dueDate)) errors.push("Project due date must be YYYY-MM-DD.");
  return { errors, name, description: cleanText(body.description), status, dueDate };
}

function validateTaskInput(body, partial = false) {
  const errors = [];
  const title = cleanText(body.title);
  const status = body.status || "Todo";
  const priority = body.priority || "Medium";
  const dueDate = emptyToNull(body.dueDate);
  const assigneeId = body.assigneeId ? Number(body.assigneeId) : null;

  if (!partial || "title" in body) {
    if (title.length < 3) errors.push("Task title must be at least 3 characters.");
    if (title.length > 120) errors.push("Task title must be 120 characters or less.");
  }
  if (!["Todo", "In Progress", "Review", "Done"].includes(status)) {
    errors.push("Task status is invalid.");
  }
  if (!["Low", "Medium", "High"].includes(priority)) {
    errors.push("Task priority is invalid.");
  }
  if (body.assigneeId && !Number.isInteger(assigneeId)) {
    errors.push("Assignee must be a valid user.");
  }
  if (!isValidDate(dueDate)) errors.push("Task due date must be YYYY-MM-DD.");
  return {
    errors,
    title,
    description: cleanText(body.description),
    status,
    priority,
    dueDate,
    assigneeId
  };
}

function parseRoute(url) {
  const parsed = new URL(url, `http://${HOST}:${PORT}`);
  const parts = parsed.pathname.split("/").filter(Boolean);
  return { parsed, parts };
}

async function handleApi(req, res) {
  const { parsed, parts } = parseRoute(req.url);
  const method = req.method || "GET";

  if (method === "POST" && parsed.pathname === "/api/auth/signup") {
    const body = await readBody(req);
    const errors = [];
    const name = cleanText(body.name);
    const email = cleanText(body.email).toLowerCase();
    const existingUsers = db.prepare("SELECT COUNT(*) AS total FROM users").get().total;
    const role = existingUsers === 0 ? "Admin" : "Member";

    if (name.length < 2) errors.push("Name must be at least 2 characters.");
    if (!isValidEmail(email)) errors.push("Enter a valid email address.");
    errors.push(...passwordErrors(body.password || ""));
    if (errors.length) return sendError(res, 422, "Please fix the highlighted fields.", errors);

    try {
      const user = createUserRecord(name, email, body.password, role);
      const token = signToken(user);
      return sendJson(res, 201, { user: publicUser(user), token });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        return sendError(res, 409, "An account with this email already exists.");
      }
      throw error;
    }
  }

  if (method === "POST" && parsed.pathname === "/api/auth/login") {
    const body = await readBody(req);
    const user = getUserByEmail(body.email || "");
    if (!user || !verifyPassword(body.password || "", user.password_hash)) {
      return sendError(res, 401, "Invalid email or password.");
    }
    const safeUser = getUserById(user.id);
    return sendJson(res, 200, { user: publicUser(safeUser), token: signToken(safeUser) });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  if (method === "GET" && parsed.pathname === "/api/auth/me") {
    return sendJson(res, 200, { user: publicUser(user) });
  }

  if (method === "GET" && parsed.pathname === "/api/dashboard") {
    return sendJson(res, 200, dashboard(user));
  }

  if (method === "GET" && parsed.pathname === "/api/users") {
    const users = db
      .prepare(
        "SELECT id, name, email, role, created_at AS createdAt FROM users ORDER BY name"
      )
      .all();
    return sendJson(res, 200, { users });
  }

  if (method === "PATCH" && parts[0] === "api" && parts[1] === "users" && parts[3] === "role") {
    if (!requireGlobalAdmin(user, res)) return;
    const targetId = Number(parts[2]);
    const body = await readBody(req);
    if (!["Admin", "Member"].includes(body.role)) {
      return sendError(res, 422, "Role must be Admin or Member.");
    }
    const target = getUserById(targetId);
    if (!target) return sendError(res, 404, "User was not found.");
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(body.role, targetId);
    return sendJson(res, 200, { user: publicUser(getUserById(targetId)) });
  }

  if (parts[0] === "api" && parts[1] === "projects" && parts.length === 2) {
    if (method === "GET") {
      return sendJson(res, 200, { projects: listProjects(user) });
    }

    if (method === "POST") {
      if (!requireGlobalAdmin(user, res)) return;
      const body = await readBody(req);
      const { errors, name, description, status, dueDate } = validateProjectInput(body);
      if (errors.length) return sendError(res, 422, "Project validation failed.", errors);

      const projectId = insertProject({
        name,
        description,
        status,
        dueDate,
        ownerId: user.id
      });
      addProjectMember(projectId, user.id, "Admin");
      const memberIds = Array.isArray(body.memberIds) ? body.memberIds : [];
      for (const memberId of new Set(memberIds.map(Number).filter(Boolean))) {
        if (memberId !== user.id && getUserById(memberId)) {
          addProjectMember(projectId, memberId, "Member");
        }
      }
      return sendJson(res, 201, { project: projectPayload(getProject(projectId), user) });
    }
  }

  if (parts[0] === "api" && parts[1] === "projects" && parts[2]) {
    const projectId = Number(parts[2]);
    const project = getProject(projectId);
    if (!project) return sendError(res, 404, "Project was not found.");

    if (method === "GET" && parts.length === 3) {
      if (!canViewProject(projectId, user)) return sendError(res, 403, "You are not on this project.");
      return sendJson(res, 200, { project: projectPayload(project, user) });
    }

    if (method === "PUT" && parts.length === 3) {
      if (!canManageProject(projectId, user)) {
        return sendError(res, 403, "Only project admins can edit this project.");
      }
      const body = await readBody(req);
      const { errors, name, description, status, dueDate } = validateProjectInput(body);
      if (errors.length) return sendError(res, 422, "Project validation failed.", errors);
      db.prepare(
        `UPDATE projects
         SET name = ?, description = ?, status = ?, due_date = ?
         WHERE id = ?`
      ).run(name, description, status, dueDate, projectId);
      return sendJson(res, 200, { project: projectPayload(getProject(projectId), user) });
    }

    if (parts[3] === "members" && method === "POST") {
      if (!canManageProject(projectId, user)) {
        return sendError(res, 403, "Only project admins can manage team members.");
      }
      const body = await readBody(req);
      const targetId = Number(body.userId);
      const role = body.role || "Member";
      if (!getUserById(targetId)) return sendError(res, 404, "User was not found.");
      if (!["Admin", "Member"].includes(role)) return sendError(res, 422, "Role must be Admin or Member.");
      addProjectMember(projectId, targetId, role);
      return sendJson(res, 200, { project: projectPayload(getProject(projectId), user) });
    }

    if (parts[3] === "members" && parts[4] && method === "DELETE") {
      if (!canManageProject(projectId, user)) {
        return sendError(res, 403, "Only project admins can manage team members.");
      }
      const targetId = Number(parts[4]);
      if (targetId === project.ownerId) {
        return sendError(res, 422, "Project owner cannot be removed.");
      }
      db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run(projectId, targetId);
      db.prepare(
        `UPDATE tasks
         SET assignee_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE project_id = ? AND assignee_id = ?`
      ).run(projectId, targetId);
      return sendJson(res, 200, { project: projectPayload(getProject(projectId), user) });
    }

    if (parts[3] === "tasks" && parts.length === 4) {
      if (!canViewProject(projectId, user)) return sendError(res, 403, "You are not on this project.");

      if (method === "GET") {
        return sendJson(res, 200, { tasks: projectPayload(project, user).tasks });
      }

      if (method === "POST") {
        if (!canManageProject(projectId, user)) {
          return sendError(res, 403, "Only admins can create tasks for this project.");
        }
        const body = await readBody(req);
        const task = validateTaskInput(body);
        if (task.errors.length) return sendError(res, 422, "Task validation failed.", task.errors);
        if (task.assigneeId && !projectRole(projectId, task.assigneeId)) {
          return sendError(res, 422, "Assignee must be a member of this project.");
        }
        const taskId = insertTask({
          projectId,
          title: task.title,
          description: task.description,
          assigneeId: task.assigneeId,
          creatorId: user.id,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate
        });
        const created = projectPayload(getProject(projectId), user).tasks.find((item) => item.id === taskId);
        return sendJson(res, 201, { task: created });
      }
    }
  }

  if (parts[0] === "api" && parts[1] === "tasks" && parts[2]) {
    const taskId = Number(parts[2]);
    const task = db
      .prepare(
        `SELECT
          t.*,
          p.owner_id AS projectOwnerId
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         WHERE t.id = ?`
      )
      .get(taskId);
    if (!task) return sendError(res, 404, "Task was not found.");
    const projectId = task.project_id;
    if (!canViewProject(projectId, user)) return sendError(res, 403, "You cannot access this task.");

    if (method === "PATCH") {
      const body = await readBody(req);
      const isManager = canManageProject(projectId, user);
      const isAssignee = task.assignee_id === user.id;

      if (!isManager && !isAssignee) {
        return sendError(res, 403, "Only task assignees or project admins can update this task.");
      }

      if (!isManager) {
        if (!body.status || Object.keys(body).some((key) => key !== "status")) {
          return sendError(res, 403, "Members can only update the status of their assigned tasks.");
        }
      }

      const next = {
        title: "title" in body ? cleanText(body.title) : task.title,
        description: "description" in body ? cleanText(body.description) : task.description,
        status: body.status || task.status,
        priority: body.priority || task.priority,
        dueDate: "dueDate" in body ? emptyToNull(body.dueDate) : task.due_date,
        assigneeId: "assigneeId" in body ? (body.assigneeId ? Number(body.assigneeId) : null) : task.assignee_id
      };
      const validation = validateTaskInput(next);
      if (validation.errors.length) return sendError(res, 422, "Task validation failed.", validation.errors);
      if (next.assigneeId && !projectRole(projectId, next.assigneeId)) {
        return sendError(res, 422, "Assignee must be a member of this project.");
      }

      db.prepare(
        `UPDATE tasks
         SET title = ?,
             description = ?,
             assignee_id = ?,
             status = ?,
             priority = ?,
             due_date = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        next.title,
        next.description,
        next.assigneeId,
        next.status,
        next.priority,
        next.dueDate,
        taskId
      );
      return sendJson(res, 200, { project: projectPayload(getProject(projectId), user) });
    }
  }

  sendError(res, 404, "API route was not found.");
}

function safeStaticPath(urlPath) {
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const normalized = path.normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(PUBLIC_DIR, normalized);
  if (!fullPath.startsWith(PUBLIC_DIR)) return null;
  return fullPath;
}

function serveStatic(req, res) {
  const { parsed } = parseRoute(req.url);
  const fullPath = safeStaticPath(parsed.pathname);
  if (!fullPath) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(fullPath, (error, content) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) {
          res.writeHead(404);
          return res.end("Not found");
        }
        res.writeHead(200, { "Content-Type": staticTypes[".html"] });
        res.end(fallback);
      });
      return;
    }

    const ext = path.extname(fullPath);
    res.writeHead(200, {
      "Content-Type": staticTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(content);
  });
}

migrate();
seed();

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    sendError(res, status, status >= 500 ? "Something went wrong on the server." : error.message);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Team Task Manager running at http://${HOST}:${PORT}`);
});

function shutdown() {
  server.close(() => {
    try {
      db.close();
    } catch {
      // Ignore close errors during process shutdown.
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
