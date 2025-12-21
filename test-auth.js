#!/usr/bin/env node

const http = require('http');

console.log('🧪 Testing MyFlix Authentication API');
console.log('=====================================\n');

// Test data for login
const loginData = JSON.stringify({
  username: 'admin',
  password: 'admin123'
});

// Request options
const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(loginData)
  }
};

// Test login endpoint
function testLogin() {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve({ status: res.statusCode, data: response });
        } catch (error) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.write(loginData);
    req.end();
  });
}

// Test health endpoint
function testHealth() {
  return new Promise((resolve, reject) => {
    const healthOptions = {
      hostname: 'localhost',
      port: 5000,
      path: '/api/health',
      method: 'GET'
    };
    
    const req = http.request(healthOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve({ status: res.statusCode, data: response });
        } catch (error) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.end();
  });
}

async function runTests() {
  console.log('🏥 Testing server health...');
  
  try {
    const healthResult = await testHealth();
    if (healthResult.status === 200) {
      console.log('✅ Server is running');
      console.log(`   Response: ${healthResult.data.message}\n`);
    } else {
      console.log(`❌ Server health check failed (${healthResult.status})\n`);
      return;
    }
  } catch (error) {
    console.log('❌ Server is not running or not accessible');
    console.log('   Make sure to run "npm run dev" first\n');
    return;
  }
  
  console.log('🔐 Testing admin login...');
  
  try {
    const loginResult = await testLogin();
    
    if (loginResult.status === 200) {
      console.log('✅ Login successful!');
      console.log(`   Username: ${loginResult.data.user.username}`);
      console.log(`   Email: ${loginResult.data.user.email}`);
      console.log(`   Admin: ${loginResult.data.user.isAdmin}`);
      console.log(`   Token received: ${loginResult.data.token ? 'Yes' : 'No'}`);
    } else {
      console.log(`❌ Login failed (${loginResult.status})`);
      console.log(`   Error: ${loginResult.data.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.log('❌ Login request failed');
    console.log(`   Error: ${error.message}`);
  }
  
  console.log('\n📋 Test complete!');
  console.log('\nIf login was successful, you can now:');
  console.log('1. Open http://localhost:3000 in your browser');
  console.log('2. Click "Sign In"');
  console.log('3. Use username: admin, password: admin123');
}

runTests(); 