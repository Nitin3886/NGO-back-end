// Run: node create_admin.js
import fetch from 'node-fetch';

const res = await fetch('http://localhost:5001/api/admin/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fullName: 'Admin',
    email: 'admin@ngoconnect.com',
    password: 'admin123456',
    adminSecret: 'ngo_admin_secret_2026'
  })
});
const data = await res.json();
console.log('\n=== ADMIN ACCOUNT ===');
console.log(JSON.stringify(data, null, 2));
if (data.token) {
  console.log('\n✅ Admin created! Login with:');
  console.log('   Email:    admin@ngoconnect.com');
  console.log('   Password: admin123456');
} else {
  console.log('\n⚠️  Response above — admin may already exist, try logging in directly.');
}
