// 550/hour per-page rate cap — see PROJECT_SPEC.md §5
// In-memory counters reset each hour; window start tracked per page.
const counters = {}; // { [pageId]: { count, windowStart } }

const LIMIT = 550;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkAndIncrement(pageId) {
  const now = Date.now();
  if (!counters[pageId] || now - counters[pageId].windowStart >= WINDOW_MS) {
    counters[pageId] = { count: 0, windowStart: now };
  }
  const entry = counters[pageId];
  if (entry.count >= LIMIT) {
    return { allowed: false, count: entry.count, limit: LIMIT };
  }
  entry.count++;
  return { allowed: true, count: entry.count, limit: LIMIT };
}

function getStatus(pageId) {
  const entry = counters[pageId];
  if (!entry) return { count: 0, limit: LIMIT };
  return { count: entry.count, limit: LIMIT };
}

module.exports = { checkAndIncrement, getStatus };
