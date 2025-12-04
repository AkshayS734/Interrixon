import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import Loading from '../components/Loading';

const UserPanel = () => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  
  const [socket, setSocket] = useState(null);
  const [poll, setPoll] = useState(null);
  const [selectedOption, setSelectedOption] = useState('');
  const [userId] = useState(() => 
    localStorage.getItem('userId') || 
    'user_' + Math.random().toString(36).substr(2, 9)
  );
  const [hasVoted, setHasVoted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [voting, setVoting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  // Store userId in localStorage
  useEffect(() => {
    localStorage.setItem('userId', userId);
  }, [userId]);

  // Socket connection and cleanup
  useEffect(() => {
    if (!sessionId) {
      setError('No session ID provided');
      setLoading(false);
      return;
    }

    const newSocket = io(import.meta.env?.VITE_SOCKET_URL || 'http://localhost:3000', {
      timeout: 10000,
      forceNew: true
    });

    // Connection event handlers
    newSocket.on('connect', () => {
      setConnectionStatus('connected');
      setError(null);
      
      // Join poll room
      newSocket.emit('joinPoll', { sessionId, userType: 'user' }, (response) => {
        setLoading(false);
        if (response.success) {
          setPoll(response.poll);
          setHasVoted(response.poll.voters && response.poll.voters.includes(userId));
        } else {
          setError(response.message || 'Failed to join poll');
        }
      });
    });

    newSocket.on('connect_error', () => {
      setConnectionStatus('error');
      setError('Connection failed. Please check your internet connection.');
      setLoading(false);
    });

    newSocket.on('disconnect', (reason) => {
      setConnectionStatus('disconnected');
      if (reason === 'io server disconnect') {
        setError('Server disconnected. Please refresh the page.');
      }
    });

    // Poll event handlers
    newSocket.on('pollUpdate', (data) => {
      setPoll(prev => prev ? { ...prev, ...data } : null);
    });

    newSocket.on('pollClosed', (data) => {
      setError('This poll has been closed by the administrator');
      setPoll(prev => prev ? { ...prev, isActive: false, ...data } : null);
    });

    newSocket.on('participantJoined', () => {
      // Could show participant count if needed
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [sessionId, userId]);

  const handleVote = useCallback(async () => {
    if (!socket || !selectedOption || voting || hasVoted) return;

    setVoting(true);
    setError(null);

    socket.emit('vote', {
      sessionId,
      vote: selectedOption,
      userId
    }, (response) => {
      setVoting(false);
      
      if (response.success) {
        setHasVoted(true);
        setSelectedOption('');
        // Navigate to results page
        navigate(`/results/${sessionId}`);
      } else {
        setError(response.message || 'Failed to record vote');
      }
    });
  }, [socket, selectedOption, voting, hasVoted, sessionId, userId, navigate]);

  if (loading) {
    return <Loading message="Joining poll..." />;
  }

  if (error && !poll) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-red-500 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Poll Not Found</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  if (!poll) {
    return <Loading message="Loading poll..." />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Connection Status */}
        <div className="mb-4">
          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
            connectionStatus === 'connected' 
              ? 'bg-green-100 text-green-800'
              : connectionStatus === 'connecting'
              ? 'bg-yellow-100 text-yellow-800' 
              : 'bg-red-100 text-red-800'
          }`}>
            <span className={`w-2 h-2 rounded-full mr-2 ${
              connectionStatus === 'connected' ? 'bg-green-400' : 
              connectionStatus === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'
            }`}></span>
            {connectionStatus === 'connected' ? 'Connected' : 
             connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
          </span>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Poll</h1>
            <p className="text-gray-600">Session: {sessionId}</p>
          </div>

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {hasVoted ? (
            <div className="text-center">
              <div className="text-green-500 mb-4">
                <svg className="w-16 h-16 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Thank you for voting!</h2>
              <p className="text-gray-600 mb-6">Your vote has been recorded.</p>
              <button
                onClick={() => navigate(`/results/${sessionId}`)}
                className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded transition-colors"
              >
                View Results
              </button>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <h2 className="text-xl font-bold text-gray-800 mb-4">{poll.question}</h2>
                
                {poll.type === 'multiple-choice' && (
                  <div className="space-y-3">
                    {poll.options.map((option, index) => (
                      <label key={index} className="flex items-center p-3 border rounded cursor-pointer hover:bg-gray-50">
                        <input
                          type="radio"
                          name="option"
                          value={option}
                          checked={selectedOption === option}
                          onChange={(e) => setSelectedOption(e.target.value)}
                          disabled={voting}
                          className="mr-3"
                        />
                        {option}
                      </label>
                    ))}
                  </div>
                )}

                {poll.type === 'yes-no' && (
                  <div className="flex space-x-4">
                    {['Yes', 'No'].map((option) => (
                      <button
                        key={option}
                        onClick={() => setSelectedOption(option)}
                        disabled={voting}
                        className={`flex-1 p-4 rounded font-medium transition-colors ${
                          selectedOption === option
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}

                {poll.type === 'open-text' && (
                  <textarea
                    value={selectedOption}
                    onChange={(e) => setSelectedOption(e.target.value)}
                    disabled={voting}
                    placeholder="Enter your response..."
                    className="w-full p-3 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    rows="4"
                  />
                )}

                {poll.type === 'rating' && (
                  <div className="flex justify-center space-x-2">
                    {[1, 2, 3, 4, 5].map((rating) => (
                      <button
                        key={rating}
                        onClick={() => setSelectedOption(rating.toString())}
                        disabled={voting}
                        className={`w-12 h-12 rounded-full font-bold transition-colors ${
                          selectedOption === rating.toString()
                            ? 'bg-yellow-500 text-white'
                            : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                        }`}
                      >
                        {rating}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-center">
                <button
                  onClick={handleVote}
                  disabled={!selectedOption || voting}
                  className={`px-8 py-3 rounded-lg font-bold transition-colors ${
                    !selectedOption || voting
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-blue-500 hover:bg-blue-600 text-white'
                  }`}
                >
                  {voting ? (
                    <div className="flex items-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Voting...
                    </div>
                  ) : (
                    'Submit Vote'
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserPanel;