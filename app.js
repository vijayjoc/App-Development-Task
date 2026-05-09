const state = {
  token: localStorage.getItem("ttm_token"),
  user: null,
  projects: [],
  selectedProject: null,
  dashboard: null,
  users: [],
  view: "dashboard",
  authMode: "login",
  loading: false
};

const statuses = ["Todo", "In Progress", "Review", "Done"];
const statusClass = {
  Todo: "todo",
  "In Progress": "progress",
  Review: "review",
  Done: "done"
};

const app = document.querySelector("#app");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function icon(name) {
  const icons = {
    dashboard:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    projects:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H10l2 2h5.5A2.5 2.5 0 0 1 20 8.5v8A3.5 3.5 0 0 1 16.5 20h-9A3.5 3.5 0 0 1 4 16.5v-10Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    team:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M16 19c0-2.2-1.8-4-4-4s-4 1.8-4 4M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm5.5 1.5c1.7.5 2.5 1.8 2.5 3.5M17 9a3 3 0 1 0-1.8-5.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    plus:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    close:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    edit:
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 16.5-.7 4.2 4.2-.7L19 8.5 15.5 5 4 16.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    logout:
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 17H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4m4 10 5-5-5-5m5 5H9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    trash:
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7h14m-9 4v6m4-6v6M8 7l1-3h6l1 3m-9 0 1 13h8l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  return icons[name] || "";
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Request failed.");
    error.details = data.details || [];
    error.status = response.status;
    throw error;
  }
  return data;
}

function showToast(message) {
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function formatDate(value) {
  if (!value) return "No date";
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function isOverdue(task) {
  if (!task?.dueDate || task.status === "Done") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${task.dueDate}T00:00:00`) < today;
}

function roleBadge(role) {
  return `<span class="badge ${role === "Admin" ? "admin" : "member"}">${escapeHtml(role)}</span>`;
}

function authScreen() {
  const isSignup = state.authMode === "signup";
  app.className = "app-shell";
  app.innerHTML = `
    <section class="auth-screen" aria-labelledby="auth-title">
      <div class="auth-panel">
        <div>
          <p class="eyebrow">Team Task Manager</p>
          <h1 id="auth-title">Project delivery, roles, and progress in one workspace.</h1>
         <p class="muted">REST APIs, SQLite relationships, validation, task boards, dashboards, and access control are all wired into this build.</p>
        </div>
        <form id="login-form" class="auth-form">
          <div class="form-tabs" role="tablist" aria-label="Authentication mode">
            <button class="tab-button ${!isSignup ? "active" : ""}" type="button" data-auth-mode="login">Login</button>
            <button class="tab-button ${isSignup ? "active" : ""}" type="button" data-auth-mode="signup">Signup</button>
          </div>
          <label class="field signup-only ${isSignup ? "" : "hidden"}">
            <span>Name</span>
            <input name="name" type="text" autocomplete="name" placeholder="Your name">
          </label>
          <label class="field">
            <span>Email</span>
            <input name="email" type="email" autocomplete="email" value="${isSignup ? "" : "admin@taskflow.test"}" required>
          </label>
          <label class="field">
            <span>Password</span>
            <input name="password" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" value="${isSignup ? "" : "Admin123!"}" required>
          </label>
          <button class="primary-button" type="submit">${isSignup ? "Create account" : "Login"}</button>
          <p class="form-note">Demo: admin@taskflow.test / Admin123! or member@taskflow.test / Member123!</p>
          <p id="auth-error" class="error-text" role="alert"></p>
        </form>
      </div>
    </section>
  `;
}

async function boot() {
  if (!state.token) {
    authScreen();
    return;
  }

  try {
    const { user } = await api("/api/auth/me");
    state.user = user;
    await loadWorkspace();
  } catch {
    localStorage.removeItem("ttm_token");
    state.token = null;
    authScreen();
  }
}

async function loadWorkspace(options = {}) {
  state.loading = true;
  renderWorkspace();
  try {
    const [dashboard, projects, users] = await Promise.all([
      api("/api/dashboard"),
      api("/api/projects"),
      api("/api/users")
    ]);
    state.dashboard = dashboard;
    state.projects = projects.projects;
    state.users = users.users;
    if (options.keepSelected && state.selectedProject) {
      await selectProject(state.selectedProject.id, false);
    } else if (!state.selectedProject && state.projects[0]) {
      await selectProject(state.projects[0].id, false);
    }
  } finally {
    state.loading = false;
    renderWorkspace();
  }
}

function renderWorkspace() {
  if (!state.user) return;
  app.className = "workspace";
  app.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">TT</div>
        <div>
          <strong>TaskFlow</strong>
          <span>Team workspace</span>
        </div>
      </div>
      <nav class="nav-list" aria-label="Primary">
        ${navButton("dashboard", "Dashboard", "dashboard")}
        ${navButton("projects", "Projects", "projects")}
        ${navButton("team", "Team", "team")}
      </nav>
      <div class="sidebar-footer">
        <div class="user-card">
          <strong>${escapeHtml(state.user.name)}</strong>
          <span>${escapeHtml(state.user.email)}</span>
          <div class="tag-row" style="margin-top: 10px;">${roleBadge(state.user.role)}</div>
        </div>
        <button class="secondary-button" data-action="logout">${icon("logout")} Logout</button>
      </div>
    </aside>
    <section class="content">
      ${state.view === "dashboard" ? dashboardView() : ""}
      ${state.view === "projects" ? projectsView() : ""}
      ${state.view === "team" ? teamView() : ""}
    </section>
  `;
}

function navButton(view, label, iconName) {
  return `
    <button class="nav-item ${state.view === view ? "active" : ""}" data-view="${view}">
      ${icon(iconName)}
      <strong>${label}</strong>
    </button>
  `;
}

function loadingBlocks(count = 3) {
  return Array.from({ length: count }, () => `<div class="skeleton"></div>`).join("");
}

function dashboardView() {
  if (state.loading && !state.dashboard) {
    return `
      <div class="topbar"><div><p class="eyebrow">Dashboard</p><h1>Loading workspace</h1></div></div>
      <div class="grid stats-grid">${loadingBlocks(4)}</div>
    `;
  }

  const stats = state.dashboard?.stats || {};
  const statusRows = statuses.map((status) => {
    const found = state.dashboard?.byStatus?.find((item) => item.status === status);
    const count = found?.count || 0;
    const total = Math.max(stats.tasks || 0, 1);
    const width = Math.round((count / total) * 100);
    return `
      <div class="status-row">
        <span>${status}</span>
        <div class="bar-track"><div class="bar-fill ${statusClass[status]}" style="width: ${width}%"></div></div>
        <strong>${count}</strong>
      </div>
    `;
  }).join("");

  const dueSoon = state.dashboard?.dueSoon || [];
  return `
    <div class="topbar">
      <div>
        <p class="eyebrow">Dashboard</p>
        <h1>Delivery overview</h1>
        <p class="muted">Track project load, task status, overdue work, and your open assignments.</p>
      </div>
      <div class="topbar-actions">
        ${state.user.role === "Admin" ? `<button class="primary-button" data-modal="project">${icon("plus")} Project</button>` : ""}
        <button class="secondary-button" data-action="refresh">Refresh</button>
      </div>
    </div>
    <div class="grid stats-grid">
      ${statCard("Projects", stats.projects || 0, "Active workspaces")}
      ${statCard("Tasks", stats.tasks || 0, `${stats.done || 0} completed`)}
      ${statCard("Overdue", stats.overdue || 0, "Need attention")}
      ${statCard("Assigned", stats.assignedOpen || 0, "Open tasks for you")}
    </div>
    <div class="grid dashboard-grid">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Status distribution</h2>
            <p class="muted">All visible tasks grouped by workflow state.</p>
          </div>
        </div>
        <div class="status-bars">${statusRows}</div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Due next</h2>
            <p class="muted">Open tasks ordered by deadline.</p>
          </div>
        </div>
        <div class="due-list">
          ${dueSoon.length ? dueSoon.map(dueItem).join("") : emptyState("No due tasks", "Create tasks or update dates to populate this list.")}
        </div>
      </section>
    </div>
  `;
}

function statCard(label, value, caption) {
  return `
    <article class="stat-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <p class="meta">${caption}</p>
    </article>
  `;
}

function dueItem(task) {
  return `
    <article class="due-item">
      <div class="task-title-row">
        <strong>${escapeHtml(task.title)}</strong>
        ${isOverdue(task) ? '<span class="badge overdue">Overdue</span>' : ""}
      </div>
      <div class="tag-row">
        <span class="badge ${statusClass[task.status]}">${escapeHtml(task.status)}</span>
        <span class="badge ${String(task.priority).toLowerCase()}">${escapeHtml(task.priority)}</span>
      </div>
      <p class="meta">${escapeHtml(task.projectName)} · ${escapeHtml(task.assigneeName || "Unassigned")} · ${formatDate(task.dueDate)}</p>
    </article>
  `;
}

function projectsView() {
  const canCreate = state.user.role === "Admin";
  return `
    <div class="topbar">
      <div>
        <p class="eyebrow">Projects</p>
        <h1>Projects and tasks</h1>
        <p class="muted">Admins manage teams and task details. Members can update their assigned task status.</p>
      </div>
      <div class="topbar-actions">
        ${canCreate ? `<button class="primary-button" data-modal="project">${icon("plus")} Project</button>` : ""}
        ${state.selectedProject && canManageSelected() ? `<button class="secondary-button" data-modal="task">${icon("plus")} Task</button>` : ""}
      </div>
    </div>
    <div class="project-board">
      <aside class="project-list">
        ${state.projects.length ? state.projects.map(projectCard).join("") : emptyState("No projects yet", canCreate ? "Create a project to start assigning work." : "An admin can add you to a project.")}
      </aside>
      <section class="project-detail">
        ${state.selectedProject ? projectDetail(state.selectedProject) : emptyState("Select a project", "Project details and tasks will appear here.")}
      </section>
    </div>
  `;
}

function projectCard(project) {
  const done = project.doneCount || 0;
  const total = project.taskCount || 0;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return `
    <article class="project-card ${state.selectedProject?.id === project.id ? "active" : ""}" data-project-id="${project.id}">
      <div>
        <h3>${escapeHtml(project.name)}</h3>
        <p class="meta">${escapeHtml(project.ownerName)} · ${formatDate(project.dueDate)}</p>
      </div>
      <p class="muted">${escapeHtml(project.description || "No description")}</p>
      <div class="project-metrics">
        <div class="metric"><strong>${project.memberCount || 0}</strong> Members</div>
        <div class="metric"><strong>${total}</strong> Tasks</div>
        <div class="metric"><strong>${percent}%</strong> Done</div>
      </div>
      <div class="tag-row">
        <span class="badge">${escapeHtml(project.status)}</span>
      </div>
    </article>
  `;
}

function projectDetail(project) {
  const canManage = canManageSelected();
  return `
    <div class="panel">
      <div class="detail-header">
        <div>
          <h2>${escapeHtml(project.name)}</h2>
          <p class="muted">${escapeHtml(project.description || "No description")}</p>
          <div class="tag-row">
            <span class="badge">${escapeHtml(project.status)}</span>
            ${roleBadge(project.viewerRole)}
            <span class="badge">Due ${formatDate(project.dueDate)}</span>
          </div>
        </div>
        <div class="topbar-actions">
          ${canManage ? `<button class="secondary-button" data-modal="project" data-edit-project="${project.id}">${icon("edit")} Edit</button>` : ""}
          ${canManage ? `<button class="secondary-button" data-modal="member">${icon("plus")} Member</button>` : ""}
        </div>
      </div>
      <div class="task-columns">
        ${statuses.map((status) => taskColumn(status, project.tasks.filter((task) => task.status === status), canManage)).join("")}
      </div>
    </div>
  `;
}

function taskColumn(status, tasks, canManage) {
  return `
    <section class="task-column">
      <div class="task-column-header">
        <span>${status}</span>
        <span class="badge ${statusClass[status]}">${tasks.length}</span>
      </div>
      <div class="task-stack">
        ${tasks.length ? tasks.map((task) => taskCard(task, canManage)).join("") : `<div class="empty-state"><strong>Empty</strong><span>No ${status.toLowerCase()} tasks.</span></div>`}
      </div>
    </section>
  `;
}

function taskCard(task, canManage) {
  const canUpdateStatus = canManage || task.assigneeId === state.user.id;
  return `
    <article class="task-card">
      <div class="task-title-row">
        <h3>${escapeHtml(task.title)}</h3>
        ${canManage ? `<button class="icon-button" title="Edit task" data-modal="task" data-edit-task="${task.id}">${icon("edit")}</button>` : ""}
      </div>
      ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ""}
      <div class="tag-row">
        <span class="badge ${String(task.priority).toLowerCase()}">${escapeHtml(task.priority)}</span>
        ${isOverdue(task) ? '<span class="badge overdue">Overdue</span>' : ""}
      </div>
      <div class="task-footer">
        <span class="meta">${escapeHtml(task.assigneeName || "Unassigned")}</span>
        <span class="meta">${formatDate(task.dueDate)}</span>
      </div>
      ${
        canUpdateStatus
          ? `<label class="field"><span>Status</span><select data-task-status="${task.id}">${statuses.map((status) => `<option ${task.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>`
          : ""
      }
    </article>
  `;
}

function teamView() {
  const selected = state.selectedProject;
  return `
    <div class="topbar">
      <div>
        <p class="eyebrow">Team</p>
        <h1>People and roles</h1>
        <p class="muted">Global admins can create projects. Project admins can manage members inside their projects.</p>
      </div>
      <div class="topbar-actions">
        ${selected && canManageSelected() ? `<button class="primary-button" data-modal="member">${icon("plus")} Project member</button>` : ""}
      </div>
    </div>
    <div class="grid dashboard-grid">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>${selected ? escapeHtml(selected.name) : "Project team"}</h2>
            <p class="muted">${selected ? "Members assigned to the selected project." : "Select a project to review its team."}</p>
          </div>
        </div>
        <div class="team-list">
          ${selected ? selected.members.map(memberRow).join("") : emptyState("No project selected", "Open Projects and choose one first.")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>All users</h2>
            <p class="muted">Account-level roles used for platform permissions.</p>
          </div>
        </div>
        <div class="team-list">
          ${state.users.map(userRow).join("")}
        </div>
      </section>
    </div>
  `;
}

function memberRow(member) {
  const canRemove = canManageSelected() && member.id !== state.selectedProject.ownerId;
  return `
    <article class="team-row">
      <div>
        <strong>${escapeHtml(member.name)}</strong>
        <p class="meta">${escapeHtml(member.email)}</p>
      </div>
      ${roleBadge(member.role)}
      ${canRemove ? `<button class="icon-button danger-button" title="Remove member" data-remove-member="${member.id}">${icon("trash")}</button>` : ""}
    </article>
  `;
}

function userRow(user) {
  const canChange = state.user.role === "Admin" && state.user.id !== user.id;
  return `
    <article class="team-row">
      <div>
        <strong>${escapeHtml(user.name)}</strong>
        <p class="meta">${escapeHtml(user.email)}</p>
      </div>
      ${
        canChange
          ? `<select data-account-role="${user.id}" aria-label="Change account role for ${escapeHtml(user.name)}">
              <option ${user.role === "Admin" ? "selected" : ""}>Admin</option>
              <option ${user.role === "Member" ? "selected" : ""}>Member</option>
            </select>`
          : roleBadge(user.role)
      }
      <span class="meta">${formatDate((user.createdAt || "").slice(0, 10))}</span>
    </article>
  `;
}

function emptyState(title, text) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div>`;
}

function canManageSelected() {
  return state.selectedProject?.viewerRole === "Admin" || state.user?.role === "Admin";
}

async function selectProject(id, render = true) {
  const { project } = await api(`/api/projects/${id}`);
  state.selectedProject = project;
  if (render) renderWorkspace();
}

function openModal(type, id = null) {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = type === "project" ? projectModal(id) : type === "task" ? taskModal(id) : memberModal();
  document.body.appendChild(modal);
}

function closeModal() {
  document.querySelector(".modal")?.remove();
}

function projectModal(id) {
  const project = id ? state.selectedProject : null;
  return `
    <form class="modal-card form-grid" data-form="project">
      <div class="modal-header">
        <div><h2>${project ? "Edit project" : "New project"}</h2><p class="muted">Project admins can update team workspaces.</p></div>
        <button class="icon-button" type="button" data-close-modal>${icon("close")}</button>
      </div>
      <input type="hidden" name="id" value="${project?.id || ""}">
      <label class="field"><span>Name</span><input name="name" value="${escapeHtml(project?.name || "")}" required minlength="3"></label>
      <label class="field"><span>Description</span><textarea name="description">${escapeHtml(project?.description || "")}</textarea></label>
      <div class="form-grid two-col">
        <label class="field"><span>Status</span><select name="status">${["Planning", "Active", "Completed"].map((item) => `<option ${(project?.status || "Active") === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
        <label class="field"><span>Due date</span><input name="dueDate" type="date" value="${project?.dueDate || ""}"></label>
      </div>
      ${
        project
          ? ""
          : `<label class="field"><span>Initial members</span><select name="memberIds" multiple size="4">${state.users.filter((user) => user.id !== state.user.id).map((user) => `<option value="${user.id}">${escapeHtml(user.name)} · ${escapeHtml(user.email)}</option>`).join("")}</select></label>`
      }
      <p class="error-text" data-form-error></p>
      <button class="primary-button" type="submit">${project ? "Save project" : "Create project"}</button>
    </form>
  `;
}

function taskModal(id) {
  const task = id ? state.selectedProject.tasks.find((item) => item.id === Number(id)) : null;
  const members = state.selectedProject?.members || [];
  return `
    <form class="modal-card form-grid" data-form="task">
      <div class="modal-header">
        <div><h2>${task ? "Edit task" : "New task"}</h2><p class="muted">Assign work to project members and track status.</p></div>
        <button class="icon-button" type="button" data-close-modal>${icon("close")}</button>
      </div>
      <input type="hidden" name="id" value="${task?.id || ""}">
      <label class="field"><span>Title</span><input name="title" value="${escapeHtml(task?.title || "")}" required minlength="3"></label>
      <label class="field"><span>Description</span><textarea name="description">${escapeHtml(task?.description || "")}</textarea></label>
      <div class="form-grid two-col">
        <label class="field"><span>Assignee</span><select name="assigneeId"><option value="">Unassigned</option>${members.map((member) => `<option value="${member.id}" ${task?.assigneeId === member.id ? "selected" : ""}>${escapeHtml(member.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Due date</span><input name="dueDate" type="date" value="${task?.dueDate || ""}"></label>
        <label class="field"><span>Status</span><select name="status">${statuses.map((status) => `<option ${(task?.status || "Todo") === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
        <label class="field"><span>Priority</span><select name="priority">${["Low", "Medium", "High"].map((priority) => `<option ${(task?.priority || "Medium") === priority ? "selected" : ""}>${priority}</option>`).join("")}</select></label>
      </div>
      <p class="error-text" data-form-error></p>
      <button class="primary-button" type="submit">${task ? "Save task" : "Create task"}</button>
    </form>
  `;
}

function memberModal() {
  const existing = new Set((state.selectedProject?.members || []).map((member) => member.id));
  const options = state.users.filter((user) => !existing.has(user.id));
  return `
    <form class="modal-card form-grid" data-form="member">
      <div class="modal-header">
        <div><h2>Add member</h2><p class="muted">Add a registered user to ${escapeHtml(state.selectedProject?.name || "this project")}.</p></div>
        <button class="icon-button" type="button" data-close-modal>${icon("close")}</button>
      </div>
      <label class="field"><span>User</span><select name="userId" required>${options.map((user) => `<option value="${user.id}">${escapeHtml(user.name)} · ${escapeHtml(user.email)}</option>`).join("")}</select></label>
      <label class="field"><span>Project role</span><select name="role"><option>Member</option><option>Admin</option></select></label>
      <p class="error-text" data-form-error>${options.length ? "" : "All users are already on this project."}</p>
      <button class="primary-button" type="submit" ${options.length ? "" : "disabled"}>Add member</button>
    </form>
  `;
}

function formValues(form) {
  const data = new FormData(form);
  const values = Object.fromEntries(data.entries());
  if (form.elements.memberIds) {
    values.memberIds = Array.from(form.elements.memberIds.selectedOptions).map((option) => Number(option.value));
  }
  return values;
}

function formError(form, error) {
  const target = form.querySelector("[data-form-error]") || form.querySelector(".error-text");
  target.textContent = [error.message, ...(error.details || [])].join(" ");
}

document.addEventListener("click", async (event) => {
  const authButton = event.target.closest("[data-auth-mode]");
  if (authButton) {
    state.authMode = authButton.dataset.authMode;
    authScreen();
    return;
  }

  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    state.view = viewButton.dataset.view;
    renderWorkspace();
    return;
  }

  const logout = event.target.closest("[data-action='logout']");
  if (logout) {
    localStorage.removeItem("ttm_token");
    state.token = null;
    state.user = null;
    state.selectedProject = null;
    authScreen();
    return;
  }

  const refresh = event.target.closest("[data-action='refresh']");
  if (refresh) {
    await loadWorkspace({ keepSelected: true });
    showToast("Workspace refreshed");
    return;
  }

  const projectCard = event.target.closest("[data-project-id]");
  if (projectCard) {
    await selectProject(projectCard.dataset.projectId);
    return;
  }

  const close = event.target.closest("[data-close-modal]");
  if (close || event.target.classList.contains("modal")) {
    closeModal();
    return;
  }

  const modalButton = event.target.closest("[data-modal]");
  if (modalButton) {
    openModal(modalButton.dataset.modal, modalButton.dataset.editProject || modalButton.dataset.editTask || null);
    return;
  }

  const removeMember = event.target.closest("[data-remove-member]");
  if (removeMember) {
    await api(`/api/projects/${state.selectedProject.id}/members/${removeMember.dataset.removeMember}`, { method: "DELETE" });
    await loadWorkspace({ keepSelected: true });
    showToast("Member removed");
  }
});

document.addEventListener("change", async (event) => {
  const statusSelect = event.target.closest("[data-task-status]");
  if (statusSelect) {
    try {
      await api(`/api/tasks/${statusSelect.dataset.taskStatus}`, {
        method: "PATCH",
        body: { status: statusSelect.value }
      });
      await loadWorkspace({ keepSelected: true });
      showToast("Task status updated");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  const roleSelect = event.target.closest("[data-account-role]");
  if (roleSelect) {
    try {
      await api(`/api/users/${roleSelect.dataset.accountRole}/role`, {
        method: "PATCH",
        body: { role: roleSelect.value }
      });
      await loadWorkspace({ keepSelected: true });
      showToast("Role updated");
    } catch (error) {
      showToast(error.message);
    }
  }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;

  if (form.id === "login-form") {
    const values = formValues(form);
    const endpoint = state.authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
    try {
      const { user, token } = await api(endpoint, { method: "POST", body: values });
      state.user = user;
      state.token = token;
      localStorage.setItem("ttm_token", token);
      state.view = "dashboard";
      await loadWorkspace();
    } catch (error) {
      formError(form, error);
    }
    return;
  }

  if (form.dataset.form === "project") {
    const values = formValues(form);
    try {
      if (values.id) {
        await api(`/api/projects/${values.id}`, { method: "PUT", body: values });
      } else {
        await api("/api/projects", { method: "POST", body: values });
      }
      closeModal();
      await loadWorkspace({ keepSelected: Boolean(values.id) });
      showToast(values.id ? "Project updated" : "Project created");
    } catch (error) {
      formError(form, error);
    }
    return;
  }

  if (form.dataset.form === "task") {
    const values = formValues(form);
    values.assigneeId = values.assigneeId ? Number(values.assigneeId) : null;
    try {
      if (values.id) {
        await api(`/api/tasks/${values.id}`, { method: "PATCH", body: values });
      } else {
        await api(`/api/projects/${state.selectedProject.id}/tasks`, { method: "POST", body: values });
      }
      closeModal();
      await loadWorkspace({ keepSelected: true });
      showToast(values.id ? "Task updated" : "Task created");
    } catch (error) {
      formError(form, error);
    }
    return;
  }

  if (form.dataset.form === "member") {
    const values = formValues(form);
    try {
      await api(`/api/projects/${state.selectedProject.id}/members`, {
        method: "POST",
        body: { userId: Number(values.userId), role: values.role }
      });
      closeModal();
      await loadWorkspace({ keepSelected: true });
      showToast("Member added");
    } catch (error) {
      formError(form, error);
    }
  }
});

boot();
