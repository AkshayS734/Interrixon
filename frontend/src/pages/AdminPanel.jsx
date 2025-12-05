import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import io from 'socket.io-client';

const AdminPanel = () => {
  const navigate = useNavigate();
  const [poll, setPoll] = useState({
    question: '',
    type: 'multiple-choice',
    options: ['', '']
  });
  const [duration, setDuration] = useState(300);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [socket, setSocket] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [activePoll, setActivePoll] = useState(null);

  // (session IDs are generated server-side when creating a poll)

  useEffect(() => {
    // Check if admin is logged in
    const token = localStorage.getItem('adminToken');
    if (!token) {
      navigate('/admin/login');
      return;
    }

    // Initialize socket connection
    const newSocket = io(import.meta.env?.VITE_SOCKET_URL || 'http://localhost:3000', {
      auth: { token }
    });
    
    newSocket.on('connect', () => {
      console.log('Connected to server');
    });

    newSocket.on('pollUpdate', (data) => {
      setResults(data.results || []);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      setError('Failed to connect to server');
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!poll.question.trim()) {
      setError('Poll question cannot be empty.');
      return;
    }
    const type = poll.type;
    let cleanedOptions = [];

    if (type === 'multiple-choice') {
      cleanedOptions = poll.options.map(opt => opt.trim()).filter(opt => opt);
      if (cleanedOptions.length < 2) {
        setError('At least two non-empty options are required for multiple-choice polls.');
        return;
      }
    } else if (type === 'yes-no') {
      cleanedOptions = ['Yes', 'No'];
    } else if (type === 'rating') {
      // rating polls don't need options, responses are numeric
      cleanedOptions = [];
    } else if (type === 'open-text') {
      cleanedOptions = [];
    }

    setIsCreating(true);
    setError('');
    
    try {
      // Debug: show payload about to be sent
      console.debug('Creating poll payload', { type: poll.type, options: cleanedOptions, question: poll.question.trim(), duration });
      const token = localStorage.getItem('adminToken');
      const response = await axios.post(`${import.meta.env?.VITE_API_URL || 'http://localhost:3000'}/api/polls/create`, {
        question: poll.question.trim(),
        type: poll.type,
        options: cleanedOptions,
        duration
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.success) {
        const pollData = response.data.poll;
        setActivePoll(pollData);
        setResults(cleanedOptions.map(opt => ({ option: opt, votes: 0 })));
        setError(null);
        
        // Join the poll room via socket
        if (socket) {
          socket.emit('joinPoll', { 
            sessionId: pollData.sessionId, 
            userType: 'admin' 
          }, (response) => {
            if (!response.success) {
              console.error('Failed to join poll room:', response.message);
            }
          });
        }
      }
    } catch (error) {
      console.error('Poll creation error:', error);
      setError(error.response?.data?.message || 'Failed to create poll');
    } finally {
      setIsCreating(false);
    }
  };

  const addOption = () => {
    setPoll({ ...poll, options: [...poll.options, ''] });
  };

  const removeOption = (index) => {
    if (poll.options.length > 2) {
      const newOptions = poll.options.filter((_, i) => i !== index);
      setPoll({ ...poll, options: newOptions });
    }
  };

  const updateOption = (index, value) => {
    const newOptions = [...poll.options];
    newOptions[index] = value;
    setPoll({ ...poll, options: newOptions });
  };

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    navigate('/admin/login');
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-purple-50 to-pink-100 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800">Admin Dashboard</h1>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => navigate('/admin/previous')}
                className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded transition-colors"
              >
                See Previous Polls
              </button>
              <button
                onClick={handleLogout}
                className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded transition-colors"
              >
                Logout
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {!activePoll ? (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Poll Question
                </label>
                <input
                  type="text"
                  value={poll.question}
                  onChange={(e) => setPoll({ ...poll, question: e.target.value })}
                  placeholder="Enter your poll question"
                  disabled={isCreating}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                />
              </div>

              {poll.type === 'multiple-choice' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Options
                  </label>
                  {poll.options.map((option, index) => (
                    <div key={index} className="flex items-center mb-2">
                      <input
                        type="text"
                        value={option}
                        onChange={(e) => updateOption(index, e.target.value)}
                        placeholder={`Option ${index + 1}`}
                        disabled={isCreating}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                      />
                      {poll.options.length > 2 && (
                        <button
                          type="button"
                          onClick={() => removeOption(index)}
                          disabled={isCreating}
                          className="ml-2 px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-400"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addOption}
                    disabled={isCreating}
                    className="mt-2 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400"
                  >
                    Add Option
                  </button>
                </div>
              )}

              {/* Question type selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Question Type
                </label>
                <select
                  value={poll.type}
                  onChange={(e) => {
                    const newType = e.target.value;
                    // when switching to multiple-choice ensure options exist
                    if (newType === 'multiple-choice' && (!poll.options || poll.options.length < 2)) {
                      setPoll({ ...poll, type: newType, options: ['', ''] });
                    } else if (newType === 'yes-no') {
                      // for yes-no, set options to Yes/No but keep them hidden
                      setPoll({ ...poll, type: newType, options: ['Yes', 'No'] });
                    } else {
                      setPoll({ ...poll, type: newType });
                    }
                  }}
                  disabled={isCreating}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                >
                  <option value="multiple-choice">Multiple Choice</option>
                  <option value="yes-no">Yes / No</option>
                  <option value="open-text">Open Text</option>
                  <option value="rating">Rating (1-5)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Duration (seconds)
                </label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value))}
                  min="30"
                  max="3600"
                  disabled={isCreating}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                />
              </div>

              <button
                type="submit"
                disabled={isCreating}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isCreating ? 'Creating Poll...' : 'Create Poll'}
              </button>
            </form>
          ) : (
            <div>
              <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-6">
                <p className="font-bold">Poll Created Successfully!</p>
                <p>Session ID: <span className="font-mono text-lg">{activePoll.sessionId}</span></p>
                <p>Share this ID with participants to join the poll.</p>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-bold mb-4">{activePoll.question}</h3>
                <div className="space-y-2">
                  {results.map((result, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                      <span>{result.option}</span>
                      <span className="font-bold text-blue-600">{result.votes} votes</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex space-x-4">
                <button
                  onClick={() => navigate(`/results/${activePoll.sessionId}`)}
                  className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded transition-colors"
                >
                  View Results Page
                </button>
                <button
                  onClick={() => {
                    setActivePoll(null);
                    setResults([]);
                    setPoll({ question: '', type: 'multiple-choice', options: ['', ''] });
                  }}
                  className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded transition-colors"
                >
                  Create New Poll
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;