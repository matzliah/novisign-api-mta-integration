require('dotenv').config();
const express = require('express');
const axios = require('axios');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 3000;
const UPDATE_INTERVAL_MS = 30000; // 30 seconds

// MTA Configuration (data source example)
// Note: MTA GTFS feeds are publicly accessible, no API key needed
const MTA_FEED_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm';
const ROUTE_ID = 'F';
const STOP_QUEENS = 'D15N';
const STOP_BROOKLYN = 'D15S';

// ============================================================
// NOVISIGN API CONFIGURATION
// ============================================================
// NoviSign uses a simple REST API to update digital signage content
// Key concepts:
// 1. Catalog Items Group: A collection of data items
// 2. Item ID: Unique identifier for each data point
// 3. API Key: Authentication for your account

const NOVISIGN_CONFIG = {
  studioDomain: process.env.NOVISIGN_STUDIO_DOMAIN || 'app.novisign.com',
  apiKey: process.env.NOVISIGN_API_KEY,
  
  // This is your catalog items group name
  catalogItemsGroup: 'mta-f-train'
};

// ============================================================
// NOVISIGN API INTEGRATION - MAIN FUNCTION
// ============================================================
/**
 * Push data to NoviSign Catalog Items
 * 
 * How NoviSign Catalog API works:
 * 1. POST to: https://{studio-domain}/catalog/items/{itemsgroup}
 * 2. Headers: Content-Type: application/json, X-API-KEY: {your-api-key}
 * 3. Body format: { "data": { VALID_JSON } }
 * 
 * Each item in "data" becomes available in your NoviSign creative.
 * 
 * @param {Object} dataItems - Object with item IDs as keys and data as values
 * @param {string} itemsGroup - Optional override for catalog items group name
 * @returns {Promise<Object>} - Result of the API call
 */
async function pushToNoviSign(dataItems, itemsGroup = null) {
  const { studioDomain, apiKey, catalogItemsGroup } = NOVISIGN_CONFIG;
  
  // Use provided itemsGroup or default to config
  const targetGroup = itemsGroup || catalogItemsGroup;
  
  // STEP 1: Build the API endpoint URL
  // Format: https://{studio-domain}/catalog/items/{itemsgroup}
  const apiUrl = `https://${studioDomain}/catalog/items/${targetGroup}`;
  
  console.log('\n📡 NoviSign API Call:');
  console.log(`   URL: ${apiUrl}`);
  
  // STEP 2: Prepare headers
  // X-API-KEY is required for authentication
  const headers = {
    'Content-Type': 'application/json',
    'X-API-KEY': apiKey
  };
  
  // STEP 3: Prepare request body
  // NoviSign expects: { "data": { VALID_JSON } }
  const requestBody = {
    data: dataItems
  };
  
  console.log(`Items to update: ${Object.keys(dataItems).length}`);
  console.log(`Item IDs: ${Object.keys(dataItems).join(', ')}`);
  
  try {
    // STEP 4: Make the POST request
    const response = await axios.post(apiUrl, requestBody, { 
      headers,
      timeout: 10000 
    });
    
    console.log('✓ Success! Data pushed to NoviSign');
    
    return {
      success: true,
      itemsUpdated: Object.keys(dataItems).length,
      timestamp: new Date().toISOString(),
      response: response.data
    };
    
  } catch (error) {
    console.error('✗ NoviSign API Error:', error.message);
    
    if (error.response) {
      // API returned an error response
      console.error(`Status: ${error.response.status}`);
      console.error(`Details:`, error.response.data);
      
      throw new Error(
        `NoviSign API error (${error.response.status}): ${
          error.response.data?.message || error.message
        }`
      );
    }
    
    throw new Error(`Failed to push to NoviSign: ${error.message}`);
  }
}

// ============================================================
// NOVISIGN DATA STRUCTURE - HOW TO ORGANIZE YOUR DATA
// ============================================================
/**
 * Transform train data into NoviSign catalog items format
 * 
 * Key concept: Each item in your data object becomes accessible in NoviSign
 * by its ID. For example, if you create an item with ID "queens_1",
 * you can reference it in NoviSign creative using that exact ID.
 * 
 * Structure your data based on how you'll use it in your digital signage:
 * - Use descriptive IDs (e.g., "queens_1", "brooklyn_2")
 * - Keep field names consistent across items
 * 
 * @param {Object} trainData - Processed train arrival data
 * @returns {Object} - Data formatted for NoviSign
 */
function formatDataForNoviSign(trainData) {
  const items = {};
  
  console.log('\n📋 Formatting data for NoviSign:');
  
  // Example 1: Queens-bound trains
  // Create 3 items: queens_1, queens_2, queens_3
  trainData.queensBound.nextThreeTrains.forEach((train, index) => {
    const itemId = `queens_${index + 1}`;
    
    // Each item can have multiple fields
    // These fields will be available in your NoviSign creative
    items[itemId] = {
      minutesAway: train.minutesAway
    };
    
    console.log(`✓ ${itemId}: ${train.minutesAway}`);
  });
  
  // Fill empty slots with placeholder data
  // This ensures your NoviSign widget always has 3 items to display
  for (let i = trainData.queensBound.nextThreeTrains.length; i < 3; i++) {
    const itemId = `queens_${i + 1}`;
    items[itemId] = {
      minutesAway: '--'
    };
    console.log(`✓ ${itemId}: No train (placeholder)`);
  }
  
  // Example 2: Brooklyn-bound trains (same pattern)
  trainData.brooklynBound.nextThreeTrains.forEach((train, index) => {
    const itemId = `brooklyn_${index + 1}`;
    items[itemId] = {
      minutesAway: train.minutesAway
    };
    console.log(`✓ ${itemId}: ${train.minutesAway}`);
  });
  
  for (let i = trainData.brooklynBound.nextThreeTrains.length; i < 3; i++) {
    const itemId = `brooklyn_${i + 1}`;
    items[itemId] = {
      minutesAway: '--'
    };
    console.log(`✓ ${itemId}: No train (placeholder)`);
  }
  
  return items;
}

// ============================================================
// DATA SOURCE (MTA API) - Example implementation
// ============================================================
// This is just an example of fetching data from an external API
// You can replace this with any data source (database, API, etc.)

async function fetchFTrainArrivals() {
  try {
    const response = await axios.get(MTA_FEED_URL, {
      responseType: 'arraybuffer',
      timeout: 10000
    });

    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(response.data)
    );

    const queensArrivals = [];
    const brooklynArrivals = [];
    const now = Math.floor(Date.now() / 1000);

    feed.entity.forEach(entity => {
      if (!entity.tripUpdate?.trip || entity.tripUpdate.trip.routeId !== ROUTE_ID) return;

      entity.tripUpdate.stopTimeUpdate?.forEach(stu => {
        if (!stu.arrival?.time || !stu.stopId) return;

        const arrivalEpoch = stu.arrival.time.low || stu.arrival.time;
        const minutesAway = Math.round((arrivalEpoch - now) / 60);
        
        if (minutesAway < 0) return;

        const item = {
          minutesAway: minutesAway <= 0 ? 'Arriving' : `${minutesAway} min`,
          arrivalTime: arrivalEpoch
        };

        if (stu.stopId === STOP_QUEENS) queensArrivals.push(item);
        if (stu.stopId === STOP_BROOKLYN) brooklynArrivals.push(item);
      });
    });

    queensArrivals.sort((a, b) => a.arrivalTime - b.arrivalTime);
    brooklynArrivals.sort((a, b) => a.arrivalTime - b.arrivalTime);

    return {
      queensBound: { nextThreeTrains: queensArrivals.slice(0, 3) },
      brooklynBound: { nextThreeTrains: brooklynArrivals.slice(0, 3) }
    };

  } catch (error) {
    throw new Error(`Failed to fetch MTA data: ${error.message}`);
  }
}

// ============================================================
// COMPLETE WORKFLOW - Fetch data and push to NoviSign
// ============================================================
async function fetchAndPushToNoviSign() {
  try {
    console.log('\n🔄 Starting NoviSign Update');
    console.log('=' .repeat(60));
    
    // Step 1: Fetch data from your source (MTA in this example)
    console.log('\n1️⃣  Fetching train data from MTA API...');
    const trainData = await fetchFTrainArrivals();
    console.log('✓ Data fetched successfully');
    
    // Step 2: Format data for NoviSign
    console.log('\n2️⃣  Formatting data for NoviSign...');
    const novisignData = formatDataForNoviSign(trainData);
    
    // Step 3: Push to NoviSign
    console.log('\n3️⃣  Pushing to NoviSign API...');
    const result = await pushToNoviSign(novisignData);
    
    console.log('\n✅ Workflow completed successfully!');
    console.log('=' .repeat(60));
    
    return result;
    
  } catch (error) {
    console.error('\n❌ Workflow failed:', error.message);
    throw error;
  }
}

// ============================================================
// API ENDPOINTS - For testing and integration
// ============================================================

// Root - API documentation
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'index.html');
  
  // Check if file exists
  if (!fs.existsSync(htmlPath)) {
    return res.status(500).json({
      error: 'index.html not found',
      tip: 'Make sure index.html is in the same directory as server.js'
    });
  }
  
  // Read and send HTML file
  fs.readFile(htmlPath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({
        error: 'Failed to load index.html',
        message: err.message
      });
    }
    
    // Replace template variables with actual values
    const html = data
      .replace(/{{CATALOG_ITEMS_GROUP}}/g, NOVISIGN_CONFIG.catalogItemsGroup)
      .replace(/{{UPDATE_INTERVAL}}/g, UPDATE_INTERVAL_MS / 1000)
      .replace(/{{STUDIO_DOMAIN}}/g, NOVISIGN_CONFIG.studioDomain);
    
    res.send(html);
  });
});

// Show example NoviSign data structure AND push it to mta-f-train group
app.get('/example', async (req, res) => {
  const exampleData = {
    queens_1: {
      minutesAway: '5 min'
    },
    queens_2: {
      minutesAway: '12 min'
    },
    queens_3: {
      minutesAway: '18 min'
    },
    brooklyn_1: {
      minutesAway: '3 min'
    },
    brooklyn_2: {
      minutesAway: '8 min'
    },
    brooklyn_3: {
      minutesAway: '15 min'
    }
  };

  try {
    // Push example data to 'mta-f-train' group
    console.log('\n📤 Pushing example data to NoviSign...');
    const result = await pushToNoviSign(exampleData, 'mta-f-train');
    
    res.json({
      description: 'Example data structure and live push to NoviSign',
      pushedTo: 'mta-f-train',
      apiUrl: `https://${NOVISIGN_CONFIG.studioDomain}/catalog/items/mta-f-train`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': '***hidden***'
      },
      body: {
        data: exampleData
      },
      result: result,
      howToUseInNoviSign: {
        step1: 'Add an api connection to creative, add text box widget',
        step2: 'Select your items group: "mta-f-train"',
        step3: 'Reference items by ID: {{queens_1.minutesAway}}',
        step4: 'Data has been pushed live - check creative preview!'
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to push example data to NoviSign',
      message: error.message,
      exampleDataStructure: exampleData
    });
  }
});


// ============================================================
// AUTO-UPDATE - Continuously push data to NoviSign
// ============================================================

let updateInterval;

async function AutoUpdater() {
  console.log('\n🚀 Starting auto-update service...');
  console.log(`Interval: Every ${UPDATE_INTERVAL_MS / 1000} seconds`);
  
  // Initial update
  await fetchAndPushToNoviSign().catch(err => {
    console.error('Initial update failed:', err.message);
  });
  
  // Set up recurring updates
  updateInterval = setInterval(async () => {
    await fetchAndPushToNoviSign().catch(err => {
      console.error('Auto-update failed:', err.message);
    });
  }, UPDATE_INTERVAL_MS);
}

// ============================================================
// SERVER STARTUP
// ============================================================

async function startServer() {
  try {
    
    app.listen(PORT, () => {
      console.log('\n' + '='.repeat(60));
      console.log('📺 NoviSign API Integration Server');
      console.log('='.repeat(60));
      console.log(`\nServer: http://localhost:${PORT}`);
      console.log(`\n📚 Learn about NoviSign API:`);
      console.log(`   → Open http://localhost:${PORT} in your browser`);
      console.log(`\n🧪 Test endpoints:`);
      console.log(`   → GET  http://localhost:${PORT}/example`);
      console.log('\n' + '='.repeat(60) + '\n');
    });
    
    // Start auto-updates
    AutoUpdater();
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('\nShutting down...');
      clearInterval(updateInterval);
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start:', error.message);
    console.error('\n💡 Make sure you have set these environment variables:');
    console.error('   - NOVISIGN_API_KEY');
    console.error('   - NOVISIGN_STUDIO_DOMAIN');
    process.exit(1);
  }
}

startServer();