const https = require('https');
https.get('https://api.github.com/repos/facebook/react/git/trees/main', {
  headers: { 'User-Agent': 'Node.js' }
}, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    const tree = JSON.parse(data);
    const blob = tree.tree.find(t => t.type === 'blob');
    console.log('Blob URL:', blob.url);
    https.get(blob.url, {
      headers: { 'Accept': 'application/vnd.github.v3.raw', 'User-Agent': 'Node.js' }
    }, (res2) => {
      console.log('Status:', res2.statusCode);
      let data2 = '';
      res2.on('data', d => data2 += d);
      res2.on('end', () => console.log('Data:', data2.substring(0, 100)));
    });
  });
});
