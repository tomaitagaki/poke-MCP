#!/usr/bin/env node
/**
 * Test script to verify MCP server is working correctly
 * Usage: node test-mcp.js <server-url>
 * Example: node test-mcp.js https://x-mcp-server.onrender.com
 */

const SERVER_URL = process.argv[2] || 'http://localhost:3000';

console.log('🧪 Testing MCP Server:', SERVER_URL);
console.log('');

// Test 1: Health Check
async function testHealth() {
  console.log('1️⃣  Testing /health endpoint...');
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    const data = await response.json();

    if (data.status === 'ok') {
      console.log('✅ Health check passed');
      console.log('   Service:', data.service);
      console.log('   Version:', data.version);
      console.log('   Available endpoints:', Object.keys(data.endpoints).join(', '));
      return true;
    } else {
      console.log('❌ Health check failed');
      return false;
    }
  } catch (error) {
    console.log('❌ Health check error:', error.message);
    return false;
  }
}

// Test 2: Tools Endpoint
async function testTools() {
  console.log('\n2️⃣  Testing /tools endpoint...');
  try {
    const response = await fetch(`${SERVER_URL}/tools`);
    const data = await response.json();

    if (data.tools && data.tools.length > 0) {
      console.log(`✅ Tools endpoint passed - ${data.tools.length} tools available`);
      console.log('   Tools:', data.tools.map(t => t.name).join(', '));
      return true;
    } else {
      console.log('❌ Tools endpoint failed - no tools found');
      return false;
    }
  } catch (error) {
    console.log('❌ Tools endpoint error:', error.message);
    return false;
  }
}

// Test 3: SSE Connection
async function testSSE() {
  console.log('\n3️⃣  Testing /sse endpoint (SSE connection)...');
  try {
    const response = await fetch(`${SERVER_URL}/sse`);

    console.log('   Status:', response.status);
    console.log('   Content-Type:', response.headers.get('content-type'));

    if (response.status === 200 && response.headers.get('content-type')?.includes('text/event-stream')) {
      console.log('✅ SSE endpoint responding correctly');
      console.log('   Note: Full SSE handshake requires MCP client');
      return true;
    } else {
      console.log('❌ SSE endpoint not configured correctly');
      return false;
    }
  } catch (error) {
    console.log('❌ SSE endpoint error:', error.message);
    return false;
  }
}

// Test 4: Message Endpoint
async function testMessage() {
  console.log('\n4️⃣  Testing /message endpoint...');
  try {
    const response = await fetch(`${SERVER_URL}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ test: 'ping' }),
    });

    const data = await response.json();

    if (response.status === 200) {
      console.log('✅ Message endpoint responding');
      console.log('   Response:', data);
      return true;
    } else {
      console.log('❌ Message endpoint failed');
      return false;
    }
  } catch (error) {
    console.log('❌ Message endpoint error:', error.message);
    return false;
  }
}

// Run all tests
async function runTests() {
  const results = {
    health: await testHealth(),
    tools: await testTools(),
    sse: await testSSE(),
    message: await testMessage(),
  };

  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Results Summary');
  console.log('='.repeat(50));

  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;

  Object.entries(results).forEach(([test, passed]) => {
    console.log(`${passed ? '✅' : '❌'} ${test}`);
  });

  console.log('');
  console.log(`Total: ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log('\n🎉 All tests passed! MCP server is working correctly.');
    console.log('\nTo connect from Poke, use:');
    console.log(`   Server URL: ${SERVER_URL}/sse`);
  } else {
    console.log('\n⚠️  Some tests failed. Check the logs above for details.');
  }

  console.log('');
}

runTests().catch(err => {
  console.error('❌ Test suite error:', err);
  process.exit(1);
});
