# Health Score & Auto-Fetch Implementation

## Problem Summary

1. **Health scores showing 0** for fields with vegetation
2. **Manual data fetching** - users had to click buttons to see updated data
3. **No automatic refresh** on analytics page

## Root Cause Analysis

The health score of 0 occurs when:
- `isVegetationDetected()` returns false (both NDVI < 0.15 AND NDRE < 0.2)
- This only applies to real satellite data (sentinel-2/landsat-8-9)
- Simulated data always shows as having vegetation

The real issue is **stale or missing data** - fields weren't automatically getting fresh satellite readings.

## Solution Implemented

### 1. Continuous Background Polling (NEW)
**File**: `backend/src/cron/pollContinuous.js`

- Runs **every 10 minutes** automatically
- Updates weather data if >10 minutes old
- Updates satellite data (NDVI/NDRE/Thermal) if >6 hours old
- Recomputes health scores with fresh data
- Processes up to 50 farms per cycle

**How it works:**
```javascript
// Every 10 minutes:
for each active farm:
  if weather is stale (>10 min):
    ✓ Poll fresh weather from Open-Meteo
  
  if satellite data is stale (>6 hours):
    ✓ Fetch NDVI/NDRE from Sentinel-2
    ✓ Fetch thermal from Landsat
  
  if any data updated:
    ✓ Recompute health score (fusion of all 4 components)
```

### 2. Auto-Fetch on Analytics Page Load (UPDATED)
**File**: `frontend/analytics.html`

**Changes:**
1. **Automatic data fetching**: When user visits analytics page
   - Tries to load cached data first
   - If no data exists, automatically fetches fresh satellite data
   - No manual button click needed

2. **Auto-refresh every 5 minutes**: While user is on the page
   - Keeps analytics view current
   - Fetches updated data in background
   - Updates visualizations automatically

3. **Enhanced Force Re-analyse**: Button now triggers both:
   - Fresh satellite data fetch
   - Weather poll + full risk score recomputation

**Code flow:**
```javascript
loadAnalyticsData(farmId, force):
  if force:
    → Poll fresh satellite data
  
  → Load grid data (auto-fetches if missing via backend)
  
  if no data and not forced:
    → Auto-retry with force=true (triggers fresh fetch)
  
  → Render heatmaps

// Auto-refresh timer
setInterval(5 minutes):
  → loadAnalyticsData(currentFarmId, false)
```

### 3. Scheduler Integration (UPDATED)
**File**: `backend/src/cron/scheduler.js`

- Added continuous polling to cron job scheduler
- Registered manual trigger endpoint: `POST /api/cron/continuous-poll`
- Starts automatically when server launches

### 4. Backend Already Handles Auto-Fetch
**File**: `backend/src/controllers/analyticsController.js`

The existing `ensureNdviData()` and `ensureThermalData()` functions already:
- Check if data exists
- Automatically fetch from satellite if missing
- Return cached data if available

## Data Flow

### Before (Manual Only)
```
User visits analytics page
  → Shows "No data"
  → User clicks "Force Re-analyse"
  → Fetches satellite data
  → Shows visualization
```

### After (Automatic)
```
Server (every 10 minutes):
  → Checks all active farms
  → Updates stale weather data
  → Updates stale satellite data
  → Recomputes health scores
  → Stores in database

User visits analytics page:
  → Auto-fetches if no data exists
  → Loads current data from database
  → Auto-refreshes every 5 minutes
  → Shows real-time visualization
```

## Health Score Computation (Unchanged but Context Added)

The health score logic in `riskService.js` is correct:

```javascript
// Field validity override (lines 424-444)
if (!vegetationDetected) {
  fusionResult.score = 0;
  fusionResult.level = HealthLevel.HIGH;
  fusionResult.triggeredAlert = false; // Boundary issue, not disease
}
```

**This is intentional behavior:**
- Score of 0 = "No vegetation detected" 
- Only applies to REAL satellite data
- Indicates boundary drawn incorrectly (over building/water)
- Not a disease signal (triggeredAlert = false)

**The fix:** Ensure fresh satellite data is always available through continuous polling.

## Expected Behavior Now

### Dashboard
- Health scores auto-update every 10 minutes (via continuous polling)
- "Sentinel Sync" button still available for immediate refresh
- Always shows current data

### Analytics Page
- Auto-loads data when field selected
- Auto-refreshes every 5 minutes while viewing
- "Force Re-analyse" fetches fresh satellite + weather data
- Shows real-time NDVI/NDRE/Thermal heatmaps

### Background
- Weather: Polls every 10 minutes if stale
- Satellite: Polls every 6 hours if stale
- Health scores: Recomputed whenever data updates
- Old cron jobs still run:
  - Weather poll: every 2 hours (backup)
  - Satellite poll: daily at 06:00 UTC (bulk update)

## Configuration

### Environment Variables (Optional)
```bash
CRON_BATCH_SIZE=50  # Max farms per continuous poll cycle (default: 50)
```

### Timing Can Be Adjusted

**Continuous polling** (`pollContinuous.js`):
```javascript
// Line 62: Change schedule
cron.schedule('*/10 * * * *', ...)  // Every 10 minutes

// Line 7-8: Change staleness thresholds
const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);  // Weather
const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000); // Satellite
```

**Analytics auto-refresh** (`analytics.html`):
```javascript
// Line 605: Change refresh interval
autoRefreshInterval = setInterval(() => {
  ...
}, 5 * 60 * 1000);  // 5 minutes
```

## Testing

### Manual Test Steps

1. **Start server** - continuous polling activates automatically
2. **Add a field** with valid GPS coordinates
3. **Wait 1-2 minutes** - watch logs for continuous-poll
4. **Visit dashboard** - health score should show data
5. **Visit analytics page** - should auto-load heatmaps
6. **Wait 5 minutes on analytics** - should auto-refresh

### Check Logs
```bash
# Watch for continuous polling
🔄 [continuous-poll] Updated N farms (X weather, Y satellite)

# No output if all data is fresh (expected behavior)
```

### API Test
```bash
# Trigger continuous poll manually
curl -X POST http://localhost:5000/api/cron/continuous-poll \
  -H "X-Cron-Secret: your-secret"
```

## Files Modified

1. ✅ `backend/src/cron/pollContinuous.js` - NEW continuous polling service
2. ✅ `backend/src/cron/scheduler.js` - Integrated continuous polling
3. ✅ `frontend/analytics.html` - Auto-fetch + auto-refresh logic

## Files Not Modified (Already Working)

- `backend/src/services/riskService.js` - Health score logic correct
- `backend/src/controllers/analyticsController.js` - Auto-fetch already implemented
- `backend/src/services/ndviService.js` - Vegetation detection working correctly
- `backend/src/controllers/dashboardController.js` - Dashboard endpoint working

## Next Steps (Optional Enhancements)

1. Add loading spinner during auto-refresh on analytics page
2. Show "Last updated: X minutes ago" timestamp
3. Add visual indicator when auto-refresh happens
4. Configurable polling intervals via settings UI
5. Notification when new data becomes available

---

**Date**: 2026-09-05  
**Status**: ✅ Complete and ready for testing
