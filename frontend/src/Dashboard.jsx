import { useState, useEffect, useCallback } from 'react';
import api from './api';

const STATUSES  = ['pending', 'in_progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ─── Add Task Form ────────────────────────────────────────────────────────────
function AddTaskForm({ onTaskAdded, addToast }) {
  const [form, setForm]       = useState({ title: '', description: '', priority: 'medium' });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setLoading(true);
    try {
      const { data } = await api.post('/tasks', form);
      onTaskAdded(data);
      setForm({ title: '', description: '', priority: 'medium' });
      addToast('✅ Task created!', 'success');
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to create task', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="add-task-card">
      <h3>+ New Task</h3>
      <form onSubmit={handleSubmit}>
        <div className="add-task-grid">
          <div className="form-group full-width">
            <label>Title *</label>
            <input name="title" className="form-control" placeholder="Deploy service to staging…" value={form.title} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Description</label>
            <input name="description" className="form-control" placeholder="Optional details…" value={form.description} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Priority</label>
            <select name="priority" className="form-control" value={form.priority} onChange={handleChange}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Creating…' : '🚀 Create Task'}
        </button>
      </form>
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────
function TaskCard({ task, onUpdate, onDelete, addToast }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus]   = useState(task.status);
  const [loading, setLoading] = useState(false);

  const handleStatusChange = async (newStatus) => {
    setLoading(true);
    try {
      const { data } = await api.put(`/tasks/${task.id}`, { status: newStatus });
      setStatus(data.status);
      onUpdate(data);
      addToast(`📝 Task updated to "${newStatus}"`, 'success');
    } catch (err) {
      addToast('Failed to update task', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${task.title}"?`)) return;
    try {
      await api.delete(`/tasks/${task.id}`);
      onDelete(task.id);
      addToast('🗑️ Task deleted', 'success');
    } catch {
      addToast('Failed to delete task', 'error');
    }
  };

  return (
    <div className="task-card">
      <div className={`task-priority-dot priority-${task.priority}`} title={`Priority: ${task.priority}`} />
      <div className="task-body">
        <div className="task-title">{task.title}</div>
        {task.description && <div className="task-desc">{task.description}</div>}
        <div className="task-meta">
          <span className={`badge badge-${status}`}>{status.replace('_', ' ')}</span>
          <span className={`badge badge-${task.priority}`}>{task.priority}</span>
          <span className="task-date">🕐 {formatDate(task.created_at)}</span>
        </div>
      </div>
      <div className="task-actions">
        <select
          className="form-control"
          style={{ fontSize: '0.78rem', padding: '4px 8px', width: 'auto' }}
          value={status}
          onChange={(e) => handleStatusChange(e.target.value)}
          disabled={loading}
        >
          {STATUSES.map(s => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
        <button className="btn btn-danger btn-sm" onClick={handleDelete}>🗑</button>
      </div>
    </div>
  );
}

// ─── Notifications Panel ──────────────────────────────────────────────────────
function NotifPanel() {
  const [notifs, setNotifs]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/notifications')
      .then(({ data }) => setNotifs(data.slice(0, 10)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="notif-panel">
      <h3>📡 Recent Notification Logs</h3>
      {loading ? <div className="loading">Loading…</div> : notifs.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No events yet.</div>
      ) : notifs.map(n => (
        <div key={n.id} className="notif-item">
          <span className="notif-event">{n.event}</span>
          <span className="notif-payload">{JSON.stringify(n.payload)}</span>
          <span className="notif-time">{formatDate(n.created_at)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function Dashboard({ user, onLogout, addToast }) {
  const [tasks, setTasks]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState('tasks');

  const fetchTasks = useCallback(async () => {
    try {
      const { data } = await api.get('/tasks');
      setTasks(data);
    } catch {
      addToast('Failed to load tasks', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const handleTaskAdded  = (task) => setTasks(prev => [task, ...prev]);
  const handleTaskUpdate = (updated) => setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
  const handleTaskDelete = (id) => setTasks(prev => prev.filter(t => t.id !== id));

  const stats = {
    total:       tasks.length,
    pending:     tasks.filter(t => t.status === 'pending').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    done:        tasks.filter(t => t.status === 'done').length,
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    onLogout();
  };

  return (
    <div className="app">
      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-brand">
          <span className="icon">⚙️</span>
          <span>DevOps <span>TaskMgr</span></span>
        </div>
        <div className="navbar-user">
          <span className="welcome">Welcome, <span className="username">{user.username}</span></span>
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Logout</button>
        </div>
      </nav>

      <div className="main-container">
        {/* Header */}
        <div className="dashboard-header">
          <div>
            <div className="page-title">Task Board</div>
            <div className="page-subtitle">Manage your DevOps tasks across services</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={fetchTasks}>🔄 Refresh</button>
        </div>

        {/* Stats */}
        <div className="stats-row">
          <div className="stat-card stat-total"><div className="stat-value">{stats.total}</div><div className="stat-label">Total</div></div>
          <div className="stat-card stat-pending"><div className="stat-value">{stats.pending}</div><div className="stat-label">Pending</div></div>
          <div className="stat-card stat-progress"><div className="stat-value">{stats.in_progress}</div><div className="stat-label">In Progress</div></div>
          <div className="stat-card stat-done"><div className="stat-value">{stats.done}</div><div className="stat-label">Done</div></div>
        </div>

        {/* Tabs */}
        <div className="tabs">
          <button className={`tab ${tab === 'tasks' ? 'active' : ''}`} onClick={() => setTab('tasks')}>📋 Tasks</button>
          <button className={`tab ${tab === 'notifications' ? 'active' : ''}`} onClick={() => setTab('notifications')}>📡 Notifications</button>
        </div>

        {tab === 'tasks' ? (
          <>
            <AddTaskForm onTaskAdded={handleTaskAdded} addToast={addToast} />
            <div className="section-header">
              <div className="section-title">Your Tasks</div>
              <span className="task-count">{tasks.length} tasks</span>
            </div>
            {loading ? (
              <div className="loading">Loading tasks…</div>
            ) : tasks.length === 0 ? (
              <div className="empty-state">
                <span className="icon">📭</span>
                No tasks yet. Create one above!
              </div>
            ) : (
              <div className="task-list">
                {tasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onUpdate={handleTaskUpdate}
                    onDelete={handleTaskDelete}
                    addToast={addToast}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <NotifPanel />
        )}
      </div>
    </div>
  );
}
