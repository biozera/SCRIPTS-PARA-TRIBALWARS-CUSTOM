# Integration Guide

This guide helps you integrate the Tribal Wars Intel Overlay with your actual data source and Tribal Wars game interface.

## Prerequisites

- Access to `tw_village_intel_latest` table or equivalent data source
- Tribal Wars game account for testing
- Browser with Tampermonkey/Greasemonkey installed
- Basic JavaScript knowledge for customization

## Step 1: Data Integration

The script needs to fetch village intelligence data. Locate the `fetchVillageIntelData()` function (around line 284) and implement one of these approaches:

### Option A: REST API
```javascript
function fetchVillageIntelData() {
    return fetch('/api/village-intel-latest', {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .catch(error => {
        console.error('Failed to fetch village data:', error);
        return [];
    });
}
```

### Option B: Local Storage
```javascript
function fetchVillageIntelData() {
    try {
        const data = localStorage.getItem('tw_village_intel_latest');
        return data ? JSON.parse(data) : [];
    } catch (error) {
        console.error('Failed to load village data from storage:', error);
        return [];
    }
}
```

### Option C: GraphQL API
```javascript
async function fetchVillageIntelData() {
    const query = `
        query {
            villageIntel {
                village_id
                x
                y
                pop_survivors
                updated_at
            }
        }
    `;
    
    try {
        const response = await fetch('/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const result = await response.json();
        return result.data.villageIntel || [];
    } catch (error) {
        console.error('GraphQL query failed:', error);
        return [];
    }
}
```

### Expected Data Format
```json
[
    {
        "village_id": 12345,
        "x": 500,
        "y": 500,
        "pop_survivors": 15000,
        "updated_at": "2026-01-10T14:30:00Z"
    }
]
```

## Step 2: DOM Integration

The script needs to find village elements on the Tribal Wars map. You must identify the correct DOM selectors.

### Finding the Correct Selectors

1. Open Tribal Wars in your browser
2. Press F12 to open Developer Tools
3. Navigate to the map view
4. Use the element picker (Ctrl+Shift+C) to inspect a village
5. Look for unique attributes or classes

### Common Tribal Wars Selectors

Different Tribal Wars versions use different DOM structures. Here are some common patterns:

**Classic Tribal Wars:**
```javascript
function applyVillageColor(village, color) {
    // Try by village ID in the map
    const villageElement = document.querySelector(`#map_village_${village.village_id}`);
    if (villageElement) {
        villageElement.style.backgroundColor = color;
        villageElement.style.opacity = '0.7';
    }
}
```

**Modern Tribal Wars:**
```javascript
function applyVillageColor(village, color) {
    // Try by coordinates
    const coordSelector = `div[data-x="${village.x}"][data-y="${village.y}"]`;
    const villageElement = document.querySelector(coordSelector);
    if (villageElement) {
        villageElement.style.backgroundColor = color;
        villageElement.style.filter = 'brightness(0.8)';
    }
}
```

**Canvas-based Maps:**
If the map uses HTML5 Canvas, you'll need a different approach:
```javascript
function redrawMapOverlay() {
    console.log('Redrawing map overlay...');
    
    const filteredData = filterRecentData(villageIntelData, settings.daysToIgnore);
    
    // For canvas-based maps, hook into the canvas drawing
    const canvas = document.querySelector('#map-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    filteredData.forEach(village => {
        const color = getColorForPopulation(village.pop_survivors);
        const [screenX, screenY] = worldToScreen(village.x, village.y);
        
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(screenX, screenY, villageSize, villageSize);
        
        if (settings.attackModeEnabled) {
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 2;
            ctx.strokeRect(screenX, screenY, villageSize, villageSize);
        }
    });
}
```

## Step 3: Hook into Map Redraws

Ensure the overlay updates when the map moves or reloads.

### For Event-Based Maps
```javascript
function installMapOverlayHook() {
    console.log('Installing Tribal Wars Intel Overlay...');
    
    // Hook into map move events
    document.addEventListener('mapMoved', redrawMapOverlay);
    document.addEventListener('mapLoaded', redrawMapOverlay);
    
    // Initial draw
    villageIntelData = fetchVillageIntelData();
    redrawMapOverlay();
}
```

### For TWMap Object
```javascript
function installMapOverlayHook() {
    if (typeof TWMap === 'undefined') {
        setTimeout(installMapOverlayHook, 1000);
        return;
    }

    villageIntelData = fetchVillageIntelData();
    
    // Hook into existing map handler
    const originalHandler = TWMap.mapHandler;
    TWMap.mapHandler = function() {
        originalHandler.apply(this, arguments);
        redrawMapOverlay();
    };
    
    // Hook into village tooltip
    const originalTooltip = TWMap.villageTooltip;
    TWMap.villageTooltip = function(villageId) {
        const result = originalTooltip.apply(this, arguments);
        addIntelToTooltip(villageId);
        return result;
    };
    
    redrawMapOverlay();
}
```

## Step 4: Testing

### Test with Mock Data
Before connecting to real data, test with mock data:

```javascript
function fetchVillageIntelData() {
    // Mock data for testing
    return [
        { village_id: 1, x: 500, y: 500, pop_survivors: 5000, updated_at: new Date().toISOString() },
        { village_id: 2, x: 501, y: 500, pop_survivors: 15000, updated_at: new Date().toISOString() },
        { village_id: 3, x: 502, y: 500, pop_survivors: 35000, updated_at: new Date().toISOString() },
        { village_id: 4, x: 503, y: 500, pop_survivors: 75000, updated_at: new Date().toISOString() },
        { village_id: 5, x: 504, y: 500, pop_survivors: 120000, updated_at: new Date().toISOString() }
    ];
}
```

### Testing Checklist

- [ ] Script loads without errors (check browser console)
- [ ] Settings button appears in top-right corner
- [ ] Settings panel opens and closes correctly
- [ ] Color pickers work and save settings
- [ ] Attack mode toggle works
- [ ] Days filter updates correctly
- [ ] Village colors appear on the map
- [ ] Colors match population ranges
- [ ] Recent filter excludes old reports
- [ ] Settings persist across page reloads

## Step 5: Optimization

### Performance Tips

1. **Debounce Map Updates:**
```javascript
let redrawTimeout;
function redrawMapOverlay() {
    clearTimeout(redrawTimeout);
    redrawTimeout = setTimeout(() => {
        // Actual redraw logic
    }, 100);
}
```

2. **Cache DOM Queries:**
```javascript
const villageCache = new Map();

function applyVillageColor(village, color) {
    let element = villageCache.get(village.village_id);
    if (!element) {
        element = document.querySelector(`#village_${village.village_id}`);
        if (element) villageCache.set(village.village_id, element);
    }
    
    if (element) {
        element.style.backgroundColor = color;
    }
}
```

3. **Batch Updates:**
```javascript
function redrawMapOverlay() {
    const filteredData = filterRecentData(villageIntelData, settings.daysToIgnore);
    
    // Use DocumentFragment for batch updates
    const updates = filteredData.map(village => ({
        element: document.querySelector(`#village_${village.village_id}`),
        color: getColorForPopulation(village.pop_survivors)
    })).filter(u => u.element);
    
    // Apply all updates at once
    requestAnimationFrame(() => {
        updates.forEach(({ element, color }) => {
            element.style.backgroundColor = color;
        });
    });
}
```

## Troubleshooting

### Script Not Loading
- Check Tampermonkey is enabled
- Verify @match pattern matches your Tribal Wars URL
- Check browser console for errors

### Colors Not Appearing
- Verify `fetchVillageIntelData()` returns valid data
- Check DOM selectors match actual HTML structure
- Use browser DevTools to inspect elements
- Add console.log statements to debug

### Settings Not Saving
- Ensure GM_setValue permission is granted
- Check for localStorage quota issues
- Verify JSON serialization works correctly

### Performance Issues
- Implement debouncing for frequent updates
- Cache DOM queries
- Limit the number of villages processed at once

## Support

For issues or questions:
1. Check the browser console for error messages
2. Review the IMPLEMENTATION_VERIFICATION.md document
3. Consult the README.md for feature documentation
4. Open an issue on GitHub with:
   - Browser version
   - Tribal Wars version/URL
   - Error messages from console
   - Steps to reproduce

## Example: Complete Integration

Here's a complete example integrating all components:

```javascript
// Custom data fetching
async function fetchVillageIntelData() {
    const response = await fetch('https://your-api.com/intel');
    const data = await response.json();
    return data.villages;
}

// Custom DOM application
function applyVillageColor(village, color) {
    const element = document.querySelector(`.village[data-id="${village.village_id}"]`);
    if (element) {
        element.style.borderColor = color;
        element.style.borderWidth = '3px';
        element.style.borderStyle = 'solid';
    }
}

// Custom map hook
function installMapOverlayHook() {
    if (!window.MAP) {
        setTimeout(installMapOverlayHook, 500);
        return;
    }
    
    fetchVillageIntelData().then(data => {
        villageIntelData = data;
        redrawMapOverlay();
    });
    
    window.MAP.on('reload', redrawMapOverlay);
    window.MAP.on('move', redrawMapOverlay);
}
```
