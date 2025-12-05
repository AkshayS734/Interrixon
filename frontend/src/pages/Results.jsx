import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import io from 'socket.io-client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Loading from '../components/Loading';

const Results = () => {
  const { sessionId } = useParams();
  const [results, setResults] = useState([]);
  const [poll, setPoll] = useState(null);
  // socket state not required here; we use the socket only inside the effect
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [totalVotes, setTotalVotes] = useState(0);

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
          if (response.poll.type === 'multiple-choice' || response.poll.type === 'yes-no') {
            setResults(response.poll.results || []);
          } else {
            // open-text or rating
            setResults(response.poll.responses || []);
          }
          setTotalVotes(response.poll.totalVotes || 0);
        } else {
          setError(response.message || 'Failed to join poll');
        }
      });
    });

    newSocket.on('connect_error', () => {
      setLoading(false);
      setError('Failed to connect to server');
    });

    newSocket.on('pollUpdate', (data) => {
      if (data.type === 'multiple-choice' || data.type === 'yes-no') {
        setResults(data.results || []);
      } else {
        setResults(data.responses || []);
      }
      setTotalVotes(data.totalVotes || 0);
      // update poll type if provided
      if (data.type && poll && poll.type !== data.type) {
        setPoll(prev => prev ? { ...prev, type: data.type } : prev);
      }
    });

    newSocket.on('pollClosed', (data) => {
      if (data.type === 'multiple-choice' || data.type === 'yes-no') {
        setResults(data.finalResults || []);
      } else {
        setResults(data.finalResponses || []);
      }
      setPoll(prev => prev ? { ...prev, isActive: false } : null);
    });

    // no need to store socket in state

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

  if (!poll) {
    return <Loading message="Loading poll data..." />;
  }

  const chartData = (poll && (poll.type === 'multiple-choice' || poll.type === 'yes-no'))
    ? results.map(result => ({
        option: result.option,
        votes: result.votes,
        percentage: totalVotes > 0 ? ((result.votes / totalVotes) * 100).toFixed(1) : 0
      }))
    : [];

  // For rating polls compute average and distribution
  let ratingStats = { average: 0, distribution: { 1:0,2:0,3:0,4:0,5:0 }, total: 0 };
  if (poll && poll.type === 'rating') {
    const ratings = results || [];
    const total = ratings.length;
    let sum = 0;
    const dist = { 1:0,2:0,3:0,4:0,5:0 };
    ratings.forEach(r => {
      const val = parseInt(r.response, 10);
      if (!isNaN(val) && val >=1 && val <=5) {
        dist[val] = (dist[val] || 0) + 1;
        sum += val;
      }
    });
    ratingStats = { average: total > 0 ? (sum / total).toFixed(1) : 0, distribution: dist, total };
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-green-50 to-blue-100 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Poll Results</h1>
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

          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-800 mb-4">{poll.question}</h2>
            <p className="text-gray-600">Total Votes: <span className="font-bold">{totalVotes}</span></p>
          </div>

          {poll.type === 'multiple-choice' || poll.type === 'yes-no' ? (
            results.length > 0 ? (
              <>
                {/* Results Table */}
                <div className="mb-8">
                  <h3 className="text-lg font-bold mb-4">Vote Breakdown</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full table-auto">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="px-4 py-2 text-left">Option</th>
                          <th className="px-4 py-2 text-center">Votes</th>
                          <th className="px-4 py-2 text-center">Percentage</th>
                          <th className="px-4 py-2 text-left">Visual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chartData.map((item, index) => (
                          <tr key={index} className="border-t">
                            <td className="px-4 py-2 font-medium">{item.option}</td>
                            <td className="px-4 py-2 text-center">{item.votes}</td>
                            <td className="px-4 py-2 text-center">{item.percentage}%</td>
                            <td className="px-4 py-2">
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
                  <h3 className="text-lg font-bold mb-4">Visual Results</h3>
                  <div className="h-96">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis 
                          dataKey="option" 
                          tick={{ fontSize: 12 }}
                          interval={0}
                          angle={-45}
                          textAnchor="end"
                          height={100}
                        />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="votes" fill="#3B82F6" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-600">No votes have been cast yet.</p>
              </div>
            )
          ) : poll.type === 'open-text' ? (
            // Open-text responses
            results.length > 0 ? (
              <div>
                <h3 className="text-lg font-bold mb-4">Open Responses</h3>
                <ul className="space-y-3">
                  {results.map((r, idx) => (
                    <li key={idx} className="p-3 bg-gray-50 rounded">
                      <div className="text-sm text-gray-600">{new Date(r.timestamp).toLocaleString()}</div>
                      <div className="mt-1 text-gray-800">{r.response}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-600">No responses have been submitted yet.</p>
              </div>
            )
          ) : poll.type === 'rating' ? (
            // Rating poll summary
            ratingStats.total > 0 ? (
              <div>
                <h3 className="text-lg font-bold mb-4">Rating Summary</h3>
                <p className="mb-4">Average Rating: <span className="font-bold text-blue-600">{ratingStats.average}</span> ({ratingStats.total} responses)</p>
                <div className="mb-4">
                  {Object.entries(ratingStats.distribution).map(([score, count]) => {
                    const pct = ratingStats.total > 0 ? ((count / ratingStats.total) * 100).toFixed(1) : 0;
                    return (
                      <div key={score} className="flex items-center mb-2">
                        <div className="w-12">{score}</div>
                        <div className="flex-1 bg-gray-200 h-4 rounded overflow-hidden mr-3">
                          <div className="bg-blue-500 h-4" style={{ width: `${pct}%` }}></div>
                        </div>
                        <div className="w-16 text-right">{count} ({pct}%)</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-600">No ratings submitted yet.</p>
              </div>
            )
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-600">No results available for this poll type.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Results;