import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const Home = () => {
  const [sessionId, setSessionId] = useState('');
  const navigate = useNavigate();

  const handleJoinPoll = (e) => {
    e.preventDefault();
    if (sessionId.trim()) {
      navigate(`/poll/${sessionId.trim().toUpperCase()}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-4">
            Interrixon
          </h1>
          <p className="text-gray-600 text-lg">
            Real-time Interactive Polling Platform
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8 mb-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">
            Join a Poll
          </h2>
          
          <form onSubmit={handleJoinPoll} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enter Session ID
              </label>
              <input
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                placeholder="Enter 6-character session ID"
                className="w-full px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-center text-lg font-mono uppercase"
                maxLength={6}
                required
              />
            </div>
            
            <button
              type="submit"
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-md transition-colors"
            >
              Join Poll
            </button>
          </form>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">
            Admin Access
          </h2>
          
          <div className="space-y-4">
            <Link
              to="/admin/login"
              className="block w-full bg-purple-500 hover:bg-purple-600 text-white font-bold py-3 px-4 rounded-md transition-colors text-center"
            >
              Admin Login
            </Link>
            
            <Link
              to="/admin/signup"
              className="block w-full bg-gray-500 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-md transition-colors text-center"
            >
              Create Admin Account
            </Link>
          </div>
        </div>

        <div className="text-center mt-8">
          <p className="text-gray-500 text-sm">
            Create polls, gather responses, and view results in real-time
          </p>
        </div>
      </div>
    </div>
  );
};

export default Home;