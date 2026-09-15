// Small helper so every route doesn't repeat the same
// `new Response(JSON.stringify(...), {...})` boilerplate — the Workers/Web
// equivalent of Vercel's `res.status(code).json(obj)` convenience.
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
