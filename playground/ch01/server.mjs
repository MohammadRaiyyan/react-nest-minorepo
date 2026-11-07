import http from "node:http";

function sendResponse(res, status, data,headers={}) {
  res.writeHead(status,{ "Content-Type": "application/json",...headers });
  res.end(JSON.stringify(data));
}
const userMap = new Map();
const server = http.createServer(async (req, res) => {
  const { method, headers, url } = req;
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  console.log(method, headers, body);

  const path = new URL(url, "http://localhost").pathname;
  const taskMmatch = path.match(/^\/tasks\/([^/]+)$/);
  if (method === "GET" && path === "/health") {
    sendResponse(res, 200, { message: "ok" });
  } else if (method === "PATCH" && taskMmatch) {
    const id = taskMmatch[1];
    try {
      const data = JSON.parse(body);
      sendResponse(res, 200, { id, ...data });
    } catch (error) {
      sendResponse(res, 400, { error: "Invalid JSON" });
    }
  } else if(method === "POST" && path=== "/login"){
    try {
      const data = JSON.parse(body);
      const id = crypto.randomUUID();
      const user = { id, username:data.username };
      userMap.set(id,user)
      sendResponse(res, 200, {username:user.username},{"Set-Cookie":`session=${id};HttpOnly; Path=/`});
    } catch (error) {
      sendResponse(res, 400, { error: "Invalid JSON" });
    }
  } else if(method === "GET" && path=== "/me"){
    try {
      const currentUserId = headers.cookie?.split("; ").find(c=> c.startsWith("session"))?.split("=")?.at(1);
      const user = userMap.get(currentUserId)
      if (!user) throw new Error("User not found")
      sendResponse(res, 200, {username:user.username});
    } catch (error) {
      sendResponse(res, 401, { error:"Not Loggedin" });
    }
  } else {
    sendResponse(res, 404, { error: "Not found" });
  }
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port: ${PORT}`);
});
