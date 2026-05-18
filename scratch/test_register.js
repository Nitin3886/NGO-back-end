
import http from 'http';

const data = JSON.stringify({
  fullName: "Test Donor",
  email: `testdonor_${Date.now()}@example.com`,
  password: "password123",
  confirmPassword: "password123",
  role: "DONOR"
});

const options = {
  hostname: 'localhost',
  port: 5001,
  path: '/api/register',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', body);
  });
});

req.on('error', (e) => {
  console.error('Problem with request:', e.message);
});

req.write(data);
req.end();
