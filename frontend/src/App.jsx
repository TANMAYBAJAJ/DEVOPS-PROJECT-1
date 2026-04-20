import { useState, useEffect } from 'react';
import Auth from './Auth';
import Dashboard from './Dashboard';

// ─── Toast System ─────────────────────────────────────────────────────────────
function ToastContainer({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
      ))}
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser]     = useState(null);
  const [toasts, setToasts] = useState([]);

  // Restore session from localStorage
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp * 1000 > Date.now()) {
          setUser({ id: payload.id, username: payload.username, email: payload.email });
        } else {
          localStorage.removeItem('token');
        }
      } catch {
        localStorage.removeItem('token');
      }
    }
  }, []);

  const addToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  };

  return (
    <>
      <ToastContainer toasts={toasts} />
      {user
        ? <Dashboard user={user} onLogout={() => setUser(null)} addToast={addToast} />
        : <Auth onLogin={(u) => setUser(u)} />
      }
    </>
  );
}
