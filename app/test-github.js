const https = require('https');
https.get('https://api.github.com/repos/facebook/react/git/blobs/8b2d3783e58d1acea53428a10d2035983f2d1b53', {
  headers: {
    'Accept': 'application/vnd.github.v3.raw',
    'User-Agent': 'Node.js'
  }
}, (res) => {
  console.log('Status:', res.statusCode);
  console.log('Headers:', res.headers);
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => console.log('Data:', data.substring(0, 100)));
});
