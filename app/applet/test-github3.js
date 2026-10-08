const https = require('https');
https.get('https://api.github.com/repos/facebook/react/git/blobs/48d2b3d27e85ab32b1a9cff47ef95ebd2700b3b0', {
  headers: { 'Accept': 'application/vnd.github.v3.raw', 'User-Agent': 'Node.js' }
}, (res) => {
  console.log('Status with Accept:', res.statusCode);
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => console.log('Data:', data.substring(0, 100)));
});
