/* 树洞本地小服务器：固定端口 8966
 * 用固定地址打开，浏览器的记忆（聊天记录、API Key）才不会丢。
 * 双击 start.bat 启动，关掉窗口树洞就睡了。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8966;
const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log('🌳 树洞开好啦：http://localhost:' + PORT + ' （只允许本机访问；关掉这个窗口树洞就睡了）');
  if (!process.env.NO_OPEN) {
    try { require('child_process').exec('start http://localhost:' + PORT); } catch {}
  }
});
