/**
 * Load Testing Configuration
 * Comprehensive performance testing setup for the learning platform
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';
import { parseHTML } from 'k6/html';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// Custom metrics
export const errorRate = new Rate('errors');
export const loginFailureRate = new Rate('login_failures');
export const apiResponseTime = new Trend('api_response_time');
export const pageLoadTime = new Trend('page_load_time');
export const enrollmentCount = new Counter('successful_enrollments');

// Load testing scenarios
export const options = {
  scenarios: {
    // Baseline load test
    baseline: {
      executor: 'constant-vus',
      vus: 10,
      duration: '5m',
      tags: { scenario: 'baseline' },
    },
    
    // Peak load simulation
    peak_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 50 },   // Ramp up
        { duration: '5m', target: 50 },   // Stay at peak
        { duration: '2m', target: 100 },  // Higher peak
        { duration: '3m', target: 100 },  // Maintain high load
        { duration: '2m', target: 0 },    // Ramp down
      ],
      tags: { scenario: 'peak_load' },
    },
    
    // Stress test
    stress_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 100 },  // Normal load
        { duration: '5m', target: 200 },  // Around breaking point
        { duration: '2m', target: 300 },  // Beyond breaking point
        { duration: '5m', target: 300 },  // Stay at stress level
        { duration: '2m', target: 0 },    // Scale down
      ],
      tags: { scenario: 'stress_test' },
    },
    
    // Spike test
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 20 },   // Normal load
        { duration: '30s', target: 200 }, // Sudden spike
        { duration: '3m', target: 200 },  // Maintain spike
        { duration: '30s', target: 20 },  // Return to normal
        { duration: '2m', target: 20 },   // Stabilize
      ],
      tags: { scenario: 'spike_test' },
    },
    
    // Volume test
    volume_test: {
      executor: 'constant-vus',
      vus: 30,
      duration: '30m',
      tags: { scenario: 'volume_test' },
    },
    
    // Soak test (endurance)
    soak_test: {
      executor: 'constant-vus',
      vus: 20,
      duration: '2h',
      tags: { scenario: 'soak_test' },
    },
  },
  
  thresholds: {
    // Response time thresholds
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    
    // Error rate thresholds
    http_req_failed: ['rate<0.01'], // Less than 1% error rate
    errors: ['rate<0.05'],          // Less than 5% application errors
    
    // Custom metric thresholds
    api_response_time: ['p(95)<300'],
    page_load_time: ['p(95)<2000'],
    login_failures: ['rate<0.02'],
  },
};

// Test configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TEST_USERS = {
  learner: {
    email: 'loadtest-learner@example.com',
    password: 'loadtest123',
  },
  instructor: {
    email: 'loadtest-instructor@example.com',
    password: 'loadtest123',
  },
  admin: {
    email: 'loadtest-admin@example.com',
    password: 'loadtest123',
  },
};

// Test data
const SAMPLE_COURSES = [
  'course-1', 'course-2', 'course-3', 'course-4', 'course-5'
];

// Utility functions
function getRandomUser() {
  const userTypes = Object.keys(TEST_USERS);
  const randomType = userTypes[Math.floor(Math.random() * userTypes.length)];
  return TEST_USERS[randomType];
}

function getRandomCourse() {
  return SAMPLE_COURSES[Math.floor(Math.random() * SAMPLE_COURSES.length)];
}

// Authentication helper
function login(user = null) {
  const testUser = user || getRandomUser();
  
  // Get login page
  const loginPageStart = Date.now();
  const loginPage = http.get(`${BASE_URL}/login`);
  pageLoadTime.add(Date.now() - loginPageStart);
  
  check(loginPage, {
    'login page loaded': (r) => r.status === 200,
    'login page has form': (r) => r.body.includes('data-testid="email"'),
  });
  
  // Extract CSRF token if needed
  const doc = parseHTML(loginPage.body);
  const csrfToken = doc.find('input[name="csrfToken"]').attr('value');
  
  // Perform login
  const loginStart = Date.now();
  const loginResponse = http.post(`${BASE_URL}/api/auth/login`, {
    email: testUser.email,
    password: testUser.password,
    csrfToken: csrfToken,
  }, {
    headers: {
      'Content-Type': 'application/json',
    },
  });
  
  apiResponseTime.add(Date.now() - loginStart);
  
  const loginSuccess = check(loginResponse, {
    'login successful': (r) => r.status === 200,
    'login returns user data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true && body.data && body.data.user;
      } catch (e) {
        return false;
      }
    },
  });
  
  if (!loginSuccess) {
    loginFailureRate.add(1);
    errorRate.add(1);
  }
  
  return loginResponse;
}

// Main test scenario
export default function() {
  const scenario = __ENV.SCENARIO || 'user_journey';
  
  switch (scenario) {
    case 'login_only':
      testLogin();
      break;
    case 'api_endpoints':
      testApiEndpoints();
      break;
    case 'course_browsing':
      testCourseBrowsing();
      break;
    case 'learning_experience':
      testLearningExperience();
      break;
    default:
      testUserJourney();
  }
  
  // Random sleep between 1-5 seconds
  sleep(Math.random() * 4 + 1);
}

// Test scenarios
function testLogin() {
  const user = getRandomUser();
  login(user);
}

function testApiEndpoints() {
  // Login first
  const loginResp = login();
  if (loginResp.status !== 200) return;
  
  // Test various API endpoints
  const endpoints = [
    '/api/health',
    '/api/users/profile',
    '/api/users/stats',
    '/api/courses',
    '/api/health/redis',
  ];
  
  endpoints.forEach(endpoint => {
    const start = Date.now();
    const response = http.get(`${BASE_URL}${endpoint}`);
    apiResponseTime.add(Date.now() - start);
    
    const success = check(response, {
      [`${endpoint} responds`]: (r) => r.status === 200,
      [`${endpoint} returns JSON`]: (r) => {
        try {
          JSON.parse(r.body);
          return true;
        } catch (e) {
          return false;
        }
      },
    });
    
    if (!success) {
      errorRate.add(1);
    }
  });
}

function testCourseBrowsing() {
  // Login
  const loginResp = login();
  if (loginResp.status !== 200) return;
  
  // Browse courses page
  const start = Date.now();
  const coursesPage = http.get(`${BASE_URL}/courses`);
  pageLoadTime.add(Date.now() - start);
  
  check(coursesPage, {
    'courses page loads': (r) => r.status === 200,
    'courses page has content': (r) => r.body.includes('course-card'),
  });
  
  // Search for courses
  const searchStart = Date.now();
  const searchResponse = http.get(`${BASE_URL}/api/courses?search=javascript&page=1&limit=10`);
  apiResponseTime.add(Date.now() - searchStart);
  
  check(searchResponse, {
    'course search works': (r) => r.status === 200,
    'search returns results': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true && Array.isArray(body.data);
      } catch (e) {
        return false;
      }
    },
  });
  
  // View course details
  const courseId = getRandomCourse();
  const courseDetailStart = Date.now();
  const courseDetail = http.get(`${BASE_URL}/api/courses/${courseId}`);
  apiResponseTime.add(Date.now() - courseDetailStart);
  
  check(courseDetail, {
    'course detail loads': (r) => r.status === 200 || r.status === 404,
  });
}

function testLearningExperience() {
  // Login as learner
  const loginResp = login(TEST_USERS.learner);
  if (loginResp.status !== 200) return;
  
  // Access dashboard
  const dashboardStart = Date.now();
  const dashboard = http.get(`${BASE_URL}/dashboard`);
  pageLoadTime.add(Date.now() - dashboardStart);
  
  check(dashboard, {
    'dashboard loads': (r) => r.status === 200,
    'dashboard shows enrolled courses': (r) => r.body.includes('enrolled-courses'),
  });
  
  // Enroll in a course
  const courseId = getRandomCourse();
  const enrollStart = Date.now();
  const enrollResponse = http.post(`${BASE_URL}/api/courses/${courseId}/enroll`, {}, {
    headers: {
      'Content-Type': 'application/json',
    },
  });
  apiResponseTime.add(Date.now() - enrollStart);
  
  const enrollmentSuccess = check(enrollResponse, {
    'enrollment request processed': (r) => r.status === 200 || r.status === 409, // 409 if already enrolled
  });
  
  if (enrollmentSuccess && enrollResponse.status === 200) {
    enrollmentCount.add(1);
  }
  
  // Access course content
  const courseStart = Date.now();
  const courseAccess = http.get(`${BASE_URL}/courses/${courseId}`);
  pageLoadTime.add(Date.now() - courseStart);
  
  check(courseAccess, {
    'course content accessible': (r) => r.status === 200,
  });
}

function testUserJourney() {
  const user = getRandomUser();
  
  // Complete user journey
  const loginResp = login(user);
  if (loginResp.status !== 200) {
    errorRate.add(1);
    return;
  }
  
  // Browse courses
  const coursesStart = Date.now();
  const courses = http.get(`${BASE_URL}/courses`);
  pageLoadTime.add(Date.now() - coursesStart);
  
  check(courses, {
    'courses page accessible': (r) => r.status === 200,
  });
  
  // View profile
  const profileStart = Date.now();
  const profile = http.get(`${BASE_URL}/profile`);
  pageLoadTime.add(Date.now() - profileStart);
  
  check(profile, {
    'profile page accessible': (r) => r.status === 200,
  });
  
  // Check user stats
  const statsStart = Date.now();
  const stats = http.get(`${BASE_URL}/api/users/stats`);
  apiResponseTime.add(Date.now() - statsStart);
  
  check(stats, {
    'user stats available': (r) => r.status === 200,
  });
}

// Custom summary function
export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'load-test-summary.json': JSON.stringify(data),
    'load-test-results.html': htmlReport(data),
  };
}

function htmlReport(data) {
  const { scenarios, metrics } = data;
  
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Load Test Results</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .metric { margin: 10px 0; }
            .scenario { background: #f5f5f5; padding: 10px; margin: 10px 0; }
            .passed { color: green; }
            .failed { color: red; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
        </style>
    </head>
    <body>
        <h1>Learning Platform Load Test Results</h1>
        <p>Test completed at: ${new Date().toISOString()}</p>
        
        <h2>Scenarios</h2>
  `;
  
  Object.keys(scenarios).forEach(scenarioName => {
    const scenario = scenarios[scenarioName];
    html += `
      <div class="scenario">
        <h3>${scenarioName}</h3>
        <p>Duration: ${scenario.executor} - VUs: ${scenario.vus || 'Variable'}</p>
      </div>
    `;
  });
  
  html += `
        <h2>Performance Metrics</h2>
        <table>
            <tr><th>Metric</th><th>Value</th><th>Status</th></tr>
  `;
  
  Object.keys(metrics).forEach(metricName => {
    const metric = metrics[metricName];
    const value = metric.values?.avg || metric.values?.rate || metric.values?.count || 'N/A';
    const status = metric.thresholds?.some(t => !t.ok) ? 'failed' : 'passed';
    
    html += `
      <tr>
        <td>${metricName}</td>
        <td>${typeof value === 'number' ? value.toFixed(2) : value}</td>
        <td class="${status}">${status}</td>
      </tr>
    `;
  });
  
  html += `
        </table>
    </body>
    </html>
  `;
  
  return html;
}

// Database load testing
export function testDatabaseLoad() {
  const queries = [
    '/api/courses',
    '/api/users/profile',
    '/api/admin/users',
    '/api/users/stats',
  ];
  
  queries.forEach(query => {
    const start = Date.now();
    const response = http.get(`${BASE_URL}${query}`);
    const duration = Date.now() - start;
    
    check(response, {
      [`${query} database query responds`]: (r) => r.status === 200,
      [`${query} query under 500ms`]: () => duration < 500,
    });
    
    apiResponseTime.add(duration);
  });
}

// WebSocket load testing (if applicable)
export function testWebSocketLoad() {
  // WebSocket testing would go here if the app uses real-time features
  // This would require additional k6 extensions
}

// Memory leak detection
export function detectMemoryLeaks() {
  // Monitor for gradually increasing response times
  // This is a simplified approach - real memory leak detection would be more complex
  
  const responses = [];
  for (let i = 0; i < 10; i++) {
    const start = Date.now();
    const response = http.get(`${BASE_URL}/api/health`);
    const duration = Date.now() - start;
    responses.push(duration);
    
    sleep(1);
  }
  
  // Check if response times are increasing
  const firstHalf = responses.slice(0, 5).reduce((a, b) => a + b) / 5;
  const secondHalf = responses.slice(5).reduce((a, b) => a + b) / 5;
  
  check(null, {
    'no memory leak detected': () => secondHalf <= firstHalf * 1.5, // Allow 50% increase
  });
}