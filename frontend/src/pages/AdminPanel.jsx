import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import io from 'socket.io-client';

const AdminPanel = () => {
  const navigate = useNavigate();
  const [pollName, setPollName] = useState('');
  const [questions, setQuestions] = useState([
    { question: '', type: 'multiple-choice', options: ['', ''] }
  ]);
  const [duration, setDuration] = useState(300);
  const [error, setError] = useState('');
  const [socket, setSocket] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [activePoll, setActivePoll] = useState(null);

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

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      setError('Failed to connect to server');
    });

    // Listen for poll updates when admin is viewing a live poll
    newSocket.on('pollUpdate', (pollUpdateData) => {
      setActivePoll(prev => {
        if (!prev) return null;
        const updated = { ...prev };
        if (pollUpdateData.questionId && updated.questions) {
          const qIndex = updated.questions.findIndex(q => q._id === pollUpdateData.questionId);
          if (qIndex !== -1) {
            updated.questions[qIndex].results = pollUpdateData.results;
          }
        }
        updated.totalVotes = pollUpdateData.totalVotes;
        return updated;
      });
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validate questions
    const processedQuestions = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question.trim()) {
        setError(`Question ${i + 1} cannot be empty.`);
        return;
      }

      const type = q.type;
      let cleanedOptions = [];

      if (type === 'multiple-choice') {
        cleanedOptions = q.options.map(opt => opt.trim()).filter(opt => opt);
        if (cleanedOptions.length < 2) {
          setError(`Question ${i + 1}: At least two non-empty options are required for multiple-choice polls.`);
          return;
        }
      } else if (type === 'yes-no') {
        cleanedOptions = ['Yes', 'No'];
      } else if (type === 'rating' || type === 'open-text') {
        cleanedOptions = [];
      }

      processedQuestions.push({
        question: q.question.trim(),
        type,
        options: cleanedOptions
      });
    }

    setIsCreating(true);
    setError('');
    
    try {
      const token = localStorage.getItem('adminToken');
      const response = await axios.post(`${import.meta.env?.VITE_API_URL || 'http://localhost:3000'}/api/polls/create`, {
        pollName: pollName.trim() || 'Untitled Poll',
        questions: processedQuestions,
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

  const addQuestion = () => {
    setQuestions([...questions, { question: '', type: 'multiple-choice', options: ['', ''] }]);
  };

  const removeQuestion = (index) => {
    if (questions.length > 1) {
      const newQuestions = questions.filter((_, i) => i !== index);
      setQuestions(newQuestions);
    }
  };

  const updateQuestion = (index, field, value) => {
    const newQuestions = [...questions];
    newQuestions[index] = { ...newQuestions[index], [field]: value };
    
    // Reset options when type changes
    if (field === 'type') {
      if (value === 'yes-no') {
        newQuestions[index].options = ['Yes', 'No'];
      } else if (value === 'rating' || value === 'open-text') {
        newQuestions[index].options = [];
      } else if (value === 'multiple-choice' && (!newQuestions[index].options || newQuestions[index].options.length < 2)) {
        newQuestions[index].options = ['', ''];
      }
    }
    
    setQuestions(newQuestions);
  };

  const addOption = (questionIndex) => {
    const newQuestions = [...questions];
    newQuestions[questionIndex].options = [...newQuestions[questionIndex].options, ''];
    setQuestions(newQuestions);
  };

  const removeOption = (questionIndex, optionIndex) => {
    const newQuestions = [...questions];
    if (newQuestions[questionIndex].options.length > 2) {
      newQuestions[questionIndex].options = newQuestions[questionIndex].options.filter((_, i) => i !== optionIndex);
    }
    setQuestions(newQuestions);
  };

  const updateOption = (questionIndex, optionIndex, value) => {
    const newQuestions = [...questions];
    newQuestions[questionIndex].options[optionIndex] = value;
    setQuestions(newQuestions);
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
              {/* Poll Name Section */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Poll Name (Optional)
                </label>
                <input
                  type="text"
                  value={pollName}
                  onChange={(e) => setPollName(e.target.value)}
                  placeholder="Enter poll name (e.g., Product Feedback Survey)"
                  disabled={isCreating}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                  maxLength="200"
                />
              </div>

              {/* Questions Section */}
              <div>
                <h2 className="text-lg font-bold text-gray-800 mb-4">Poll Questions</h2>
                <div className="space-y-8">
                  {questions.map((q, qIndex) => (
                    <div key={qIndex} className="border border-gray-300 rounded p-4 bg-gray-50">
                      <div className="flex justify-between items-start mb-4">
                        <h3 className="text-md font-semibold text-gray-700">Question {qIndex + 1}</h3>
                        {questions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeQuestion(qIndex)}
                            disabled={isCreating}
                            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-400 text-sm"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Question Text
                        </label>
                        <input
                          type="text"
                          value={q.question}
                          onChange={(e) => updateQuestion(qIndex, 'question', e.target.value)}
                          placeholder="Enter your question"
                          disabled={isCreating}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                        />
                      </div>

                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Question Type
                        </label>
                        <select
                          value={q.type}
                          onChange={(e) => updateQuestion(qIndex, 'type', e.target.value)}
                          disabled={isCreating}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                        >
                          <option value="multiple-choice">Multiple Choice</option>
                          <option value="yes-no">Yes / No</option>
                          <option value="open-text">Open Text</option>
                          <option value="rating">Rating (1-5)</option>
                        </select>
                      </div>

                      {q.type === 'multiple-choice' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Options
                          </label>
                          {q.options.map((option, oIndex) => (
                            <div key={oIndex} className="flex items-center mb-2">
                              <input
                                type="text"
                                value={option}
                                onChange={(e) => updateOption(qIndex, oIndex, e.target.value)}
                                placeholder={`Option ${oIndex + 1}`}
                                disabled={isCreating}
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                              />
                              {q.options.length > 2 && (
                                <button
                                  type="button"
                                  onClick={() => removeOption(qIndex, oIndex)}
                                  disabled={isCreating}
                                  className="ml-2 px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-400 text-sm"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => addOption(qIndex)}
                            disabled={isCreating}
                            className="mt-2 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400 text-sm"
                          >
                            Add Option
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addQuestion}
                  disabled={isCreating}
                  className="mt-4 px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-400"
                >
                  Add Question
                </button>
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

              <div className="mb-6 p-4 bg-blue-50 rounded">
                <p className="text-gray-700">Total Votes: <span className="font-bold text-lg">{activePoll.totalVotes || 0}</span></p>
                <p className="text-gray-600 text-sm mt-1">{activePoll.questions.length} question(s)</p>
              </div>

              <div className="mb-6 space-y-4">
                {activePoll.questions.map((q, index) => (
                  <div key={q._id} className="border border-gray-300 rounded p-4 bg-gray-50">
                    <h3 className="text-lg font-bold mb-2">Question {index + 1}: {q.question}</h3>
                    <p className="text-sm text-gray-600 mb-3">Type: {q.type}</p>
                    {q.type === 'multiple-choice' || q.type === 'yes-no' ? (
                      <div className="space-y-2">
                        {q.options && q.options.map((opt, oIndex) => {
                          const resultItem = q.results && q.results.find(r => r.option === opt);
                          const votes = resultItem ? resultItem.votes : 0;
                          return (
                            <div key={oIndex} className="flex items-center justify-between p-2 bg-white rounded border border-gray-200">
                              <span>{opt}</span>
                              <span className="font-bold text-blue-600">{votes} vote{votes !== 1 ? 's' : ''}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">{q.type === 'rating' ? 'Rating 1-5' : 'Open text responses'}</p>
                    )}
                  </div>
                ))}
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
                    setQuestions([{ question: '', type: 'multiple-choice', options: ['', ''] }]);
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