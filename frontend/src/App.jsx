import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';

// Import your components
import Home from './pages/Home';
import AdminSignUp from './pages/AdminSignUp';
import AdminLogin from './pages/AdminLogin';
import AdminPanel from './pages/AdminPanel';
import UserPanel from './pages/UserPanel';
import Results from './pages/Results';

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <div className="App">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/admin/signup" element={<AdminSignUp />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin/panel" element={<AdminPanel />} />
            <Route path="/poll/:sessionId" element={<UserPanel />} />
            <Route path="/results/:sessionId" element={<Results />} />
          </Routes>
        </div>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
