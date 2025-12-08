import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import io from 'socket.io-client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Loading from '../components/Loading';

const Results = () => {
  const { sessionId } = useParams();
  const [poll, setPoll] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId) {
      setError('No session ID provided');
      setLoading(false);
      return;
    }

    const newSocket = io(import.meta.env?.VITE_SOCKET_URL || 'http://localhost:3000');
    
    newSocket.on('connect', () => {
      // Join poll room to get updates
      newSocket.emit('joinPoll', { sessionId, userType: 'viewer' }, (response) => {
        setLoading(false);
        if (response.success) {
          setPoll(response.poll);
        } else {
          setError(response.message || 'Failed to join poll');
        }
      });
    });

    newSocket.on('connect_error', () => {
      setLoading(false);
      setError('Failed to connect to server');
    });

    newSocket.on('pollUpdate', (pollUpdateData) => {
      // Update specific question's results
      setPoll(prev => {
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

    newSocket.on('pollClosed', () => {
      setPoll(prev => prev ? { ...prev, isActive: false } : null);
    });

    return () => {
      newSocket.close();
    };
  }, [sessionId]);

  if (loading) {
    return <Loading message="Loading poll results..." />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-linear-to-br from-red-50 to-red-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-red-500 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Unable to Load Results</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!poll || !poll.questions) {
    return <Loading message="Loading poll data..." />;
  }

  const questions = poll.questions || [];
  if (questions.length === 0) {
    return <Loading message="Loading poll data..." />;
  }

  // Helper function to render results for a single question
  const renderQuestionResults = (question, totalVotes) => {
    const { type, results } = question;

    if (type === 'multiple-choice' || type === 'yes-no') {
      if (!results || results.length === 0) {
        return (
          <div className="text-center py-8">
            <p className="text-gray-600">No votes have been cast yet.</p>
          </div>
        );
      }

      const chartData = results.map(result => ({
        option: result.option,
        votes: result.votes,
        percentage: totalVotes > 0 ? ((result.votes / totalVotes) * 100).toFixed(1) : 0
      }));

      return (
        <>
          {/* Results Table */}
          <div className="mb-8">
            <h4 className="text-md font-semibold mb-3">Vote Breakdown</h4>
            <div className="overflow-x-auto">
              <table className="w-full table-auto text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left">Option</th>
                    <th className="px-3 py-2 text-center">Votes</th>
                    <th className="px-3 py-2 text-center">Percentage</th>
                    <th className="px-3 py-2 text-left">Visual</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((item, index) => (
                    <tr key={index} className="border-t">
                      <td className="px-3 py-2 font-medium">{item.option}</td>
                      <td className="px-3 py-2 text-center">{item.votes}</td>
                      <td className="px-3 py-2 text-center">{item.percentage}%</td>
                      <td className="px-3 py-2">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${item.percentage}%` }}
                          ></div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Chart */}
          <div className="mb-8">
            <h4 className="text-md font-semibold mb-3">Visual Results</h4>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="option" 
                    tick={{ fontSize: 11 }}
                    interval={0}
                    angle={-30}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="votes" fill="#3B82F6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      );
    } else if (type === 'open-text') {
      const responses = poll.responses.filter(r => r.questionId === question._id);
      
      return responses.length > 0 ? (
        <div>
          <h4 className="text-md font-semibold mb-3">Open Responses</h4>
          <ul className="space-y-2 max-h-96 overflow-y-auto">
            {responses.map((r, idx) => (
              <li key={idx} className="p-3 bg-gray-50 rounded text-sm">
                <div className="text-xs text-gray-500 mb-1">{new Date(r.timestamp).toLocaleString()}</div>
                <div className="text-gray-800">{r.response}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-gray-600">No responses have been submitted yet.</p>
        </div>
      );
    } else if (type === 'rating') {
      const responses = poll.responses.filter(r => r.questionId === question._id);
      if (responses.length === 0) {
        return (
          <div className="text-center py-8">
            <p className="text-gray-600">No ratings submitted yet.</p>
          </div>
        );
      }

      // Calculate statistics
      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let sum = 0;
      responses.forEach(r => {
        const val = parseInt(r.response, 10);
        if (!isNaN(val) && val >= 1 && val <= 5) {
          distribution[val] = (distribution[val] || 0) + 1;
          sum += val;
        }
      });

      const average = responses.length > 0 ? (sum / responses.length).toFixed(2) : 0;

      return (
        <div>
          <h4 className="text-md font-semibold mb-3">Rating Summary</h4>
          <p className="mb-4">Average Rating: <span className="font-bold text-blue-600 text-lg">{average}</span> ({responses.length} responses)</p>
          <div>
            {[1, 2, 3, 4, 5].map((score) => {
              const count = distribution[score];
              const pct = responses.length > 0 ? ((count / responses.length) * 100).toFixed(1) : 0;
              return (
                <div key={score} className="flex items-center mb-2 text-sm">
                  <div className="w-8 font-semibold">{score}★</div>
                  <div className="flex-1 bg-gray-200 h-3 rounded overflow-hidden mx-3">
                    <div className="bg-yellow-400 h-3 transition-all duration-300" style={{ width: `${pct}%` }}></div>
                  </div>
                  <div className="w-20 text-right">{count} ({pct}%)</div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    return <div className="text-center py-8"><p className="text-gray-600">Unknown question type.</p></div>;
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-green-50 to-blue-100 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-1">{poll.pollName || 'Poll Results'}</h1>
            <p className="text-gray-600">Session: {sessionId}</p>
            {poll.isActive ? (
              <span className="inline-block mt-2 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                🟢 Live Poll
              </span>
            ) : (
              <span className="inline-block mt-2 px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-sm">
                🔴 Poll Closed
              </span>
            )}
          </div>

          <div className="mb-8 p-4 bg-blue-50 rounded">
            <p className="text-gray-700">Total Votes: <span className="font-bold text-lg">{poll.totalVotes}</span></p>
            <p className="text-gray-600 text-sm mt-1">{questions.length} question(s)</p>
          </div>

          {/* Render each question and its results */}
          <div className="space-y-8">
            {questions.map((question, qIndex) => (
              <div key={question._id} className="border border-gray-300 rounded p-6 bg-gray-50">
                <div className="mb-6">
                  <h3 className="text-lg font-bold text-gray-800 mb-1">Question {qIndex + 1}: {question.question}</h3>
                  <p className="text-sm text-gray-600">Type: <span className="font-semibold">{question.type}</span></p>
                </div>
                {renderQuestionResults(question, poll.totalVotes)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Results;