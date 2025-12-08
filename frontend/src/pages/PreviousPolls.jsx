import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Loading from '../components/Loading';

const PreviousPolls = () => {
  const navigate = useNavigate();
  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const token = localStorage.getItem('adminToken');
    if (!token) {
      navigate('/admin/login');
      return;
    }

    const fetchPolls = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await axios.get(`${import.meta.env?.VITE_API_URL || 'http://localhost:3000'}/api/polls/admin/polls`, {
          headers: {
            Authorization: `Bearer ${token}`
          },
          params: { page, limit }
        });

        if (res.data && res.data.success) {
          setPolls(res.data.polls || []);
          setTotalPages(res.data.pagination?.totalPages || 1);
        } else {
          setError(res.data?.message || 'Failed to fetch polls');
        }
      } catch (err) {
        console.error('Fetch polls error', err);
        setError(err.response?.data?.message || 'Failed to fetch polls');
      } finally {
        setLoading(false);
      }
    };

    fetchPolls();
  }, [navigate, page, limit]);

  if (loading) return <Loading message="Loading previous polls..." />;

  return (
    <div className="min-h-screen bg-linear-to-br from-gray-50 to-indigo-50 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold">Previous Polls</h1>
            <div className="space-x-2">
              <button
                onClick={() => navigate('/admin/panel')}
                className="px-3 py-2 bg-gray-200 rounded hover:bg-gray-300"
              >
                Back to Dashboard
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {polls.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-600">No previous polls found.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {polls.map((p) => (
                <div key={p.sessionId + (p.createdAt || '')} className="p-4 border rounded hover:shadow cursor-pointer" onClick={() => navigate(`/results/${p.sessionId}`)}>
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="text-lg font-semibold">{p.pollName || 'Untitled Poll'}</div>
                      <div className="text-sm text-gray-600">{p.questions && p.questions.length > 0 ? `${p.questions.length} question(s)` : 'No questions'}</div>
                        <div className="text-sm text-gray-500">Session: <span className="font-mono">{p.sessionId}</span></div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-gray-600">Votes: <span className="font-bold">{p.totalVotes}</span></div>
                        <div className="text-sm text-gray-600">{p.isActive ? 'Active' : 'Closed'}</div>
                        <div className="text-sm text-gray-400">{p.expiresAt ? new Date(p.expiresAt).toLocaleString() : ''}</div>
                    </div>
                  </div>
                </div>
              ))}              <div className="flex justify-between items-center mt-4">
                <button
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page <= 1}
                  className="px-3 py-2 bg-gray-200 rounded disabled:opacity-50"
                >
                  Previous
                </button>

                <div className="text-sm text-gray-600">Page {page} of {totalPages}</div>

                <button
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-2 bg-gray-200 rounded disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PreviousPolls;
