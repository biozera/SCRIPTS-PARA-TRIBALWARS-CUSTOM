// ==UserScript==
// @name         Tribal Wars Intel Overlay
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Village intelligence overlay for Tribal Wars with attack mode and population-based colors
// @author       biozera
// @match        https://*.tribalwars.*/game.php*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    // Default settings
    const DEFAULT_SETTINGS = {
        attackModeEnabled: false,
        daysToIgnore: 3,
        colors: {
            range0_10k: '#00FF00',      // Green
            range10_20k: '#ADD8E6',     // Light Blue
            range20_50k: '#FFFF00',     // Yellow
            range50_100k: '#FFB6C1',    // Light Red
            range100kPlus: '#8B0000',   // Dark Red
            noData: '#808080'           // Gray
        }
    };

    // Load settings from storage
    function loadSettings() {
        const savedSettings = GM_getValue('twIntelSettings', null);
        if (savedSettings) {
            try {
                const parsed = JSON.parse(savedSettings);
                return { ...DEFAULT_SETTINGS, ...parsed, colors: { ...DEFAULT_SETTINGS.colors, ...parsed.colors } };
            } catch (e) {
                console.error('Failed to parse settings:', e);
                return DEFAULT_SETTINGS;
            }
        }
        return DEFAULT_SETTINGS;
    }

    // Save settings to storage
    function saveSettings(settings) {
        GM_setValue('twIntelSettings', JSON.stringify(settings));
    }

    // Current settings
    let settings = loadSettings();

    // Get color based on population
    function getColorForPopulation(population) {
        if (population === null || population === undefined) {
            return settings.colors.noData;
        }

        const pop = parseInt(population, 10);
        if (isNaN(pop)) {
            return settings.colors.noData;
        }

        if (pop < 10000) {
            return settings.colors.range0_10k;
        } else if (pop < 20000) {
            return settings.colors.range10_20k;
        } else if (pop < 50000) {
            return settings.colors.range20_50k;
        } else if (pop < 100000) {
            return settings.colors.range50_100k;
        } else {
            return settings.colors.range100kPlus;
        }
    }

    // Filter data by date
    function filterRecentData(data, daysToIgnore) {
        if (!daysToIgnore || daysToIgnore <= 0) {
            return data;
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToIgnore);

        return data.filter(item => {
            if (!item.updated_at) {
                return false; // Exclude items without updated_at
            }
            const updatedDate = new Date(item.updated_at);
            return updatedDate >= cutoffDate;
        });
    }

    // Create settings panel UI
    function createSettingsPanel() {
        const panel = document.createElement('div');
        panel.id = 'twIntelSettingsPanel';
        panel.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #f4e4bc;
            border: 2px solid #7d510f;
            padding: 20px;
            z-index: 10000;
            width: 500px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            font-family: Verdana, Arial, sans-serif;
            display: none;
        `;

        panel.innerHTML = `
            <h2 style="margin-top: 0; color: #7d510f; border-bottom: 2px solid #7d510f; padding-bottom: 10px;">
                Intel Overlay Settings
            </h2>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: bold;">
                    <input type="checkbox" id="attackModeToggle" ${settings.attackModeEnabled ? 'checked' : ''}>
                    Enable Attack Mode
                </label>
            </div>

            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: bold;">
                    Days to ignore notes:
                </label>
                <input type="number" id="daysToIgnoreInput" value="${settings.daysToIgnore}" 
                       min="0" max="365" style="width: 100%; padding: 5px; border: 1px solid #7d510f;">
                <small style="color: #666;">Reports older than this will be filtered out</small>
            </div>

            <h3 style="color: #7d510f; border-bottom: 1px solid #7d510f; padding-bottom: 5px; margin-top: 20px;">
                Population Color Ranges
            </h3>

            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px; font-weight: bold;">0k - 10k:</label>
                <input type="color" id="color0_10k" value="${settings.colors.range0_10k}" 
                       style="width: 100%; height: 40px; border: 1px solid #7d510f; cursor: pointer;">
            </div>

            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px; font-weight: bold;">10k - 20k:</label>
                <input type="color" id="color10_20k" value="${settings.colors.range10_20k}" 
                       style="width: 100%; height: 40px; border: 1px solid #7d510f; cursor: pointer;">
            </div>

            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px; font-weight: bold;">20k - 50k:</label>
                <input type="color" id="color20_50k" value="${settings.colors.range20_50k}" 
                       style="width: 100%; height: 40px; border: 1px solid #7d510f; cursor: pointer;">
            </div>

            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px; font-weight: bold;">50k - 100k:</label>
                <input type="color" id="color50_100k" value="${settings.colors.range50_100k}" 
                       style="width: 100%; height: 40px; border: 1px solid #7d510f; cursor: pointer;">
            </div>

            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px; font-weight: bold;">100k+:</label>
                <input type="color" id="color100kPlus" value="${settings.colors.range100kPlus}" 
                       style="width: 100%; height: 40px; border: 1px solid #7d510f; cursor: pointer;">
            </div>

            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px; font-weight: bold;">Missing Information:</label>
                <input type="color" id="colorNoData" value="${settings.colors.noData}" 
                       style="width: 100%; height: 40px; border: 1px solid #7d510f; cursor: pointer;">
            </div>

            <div style="margin-top: 20px; display: flex; gap: 10px;">
                <button id="saveSettingsBtn" style="
                    flex: 1;
                    padding: 10px;
                    background: #7d510f;
                    color: white;
                    border: none;
                    cursor: pointer;
                    font-weight: bold;
                ">Save</button>
                <button id="resetSettingsBtn" style="
                    flex: 1;
                    padding: 10px;
                    background: #a0522d;
                    color: white;
                    border: none;
                    cursor: pointer;
                    font-weight: bold;
                ">Reset to Defaults</button>
                <button id="closeSettingsBtn" style="
                    flex: 1;
                    padding: 10px;
                    background: #999;
                    color: white;
                    border: none;
                    cursor: pointer;
                    font-weight: bold;
                ">Cancel</button>
            </div>
        `;

        document.body.appendChild(panel);

        // Event listeners
        document.getElementById('saveSettingsBtn').addEventListener('click', () => {
            settings.attackModeEnabled = document.getElementById('attackModeToggle').checked;
            const daysInput = parseInt(document.getElementById('daysToIgnoreInput').value, 10);
            settings.daysToIgnore = (!isNaN(daysInput) && daysInput >= 0) ? daysInput : 3;
            settings.colors.range0_10k = document.getElementById('color0_10k').value;
            settings.colors.range10_20k = document.getElementById('color10_20k').value;
            settings.colors.range20_50k = document.getElementById('color20_50k').value;
            settings.colors.range50_100k = document.getElementById('color50_100k').value;
            settings.colors.range100kPlus = document.getElementById('color100kPlus').value;
            settings.colors.noData = document.getElementById('colorNoData').value;

            saveSettings(settings);
            panel.style.display = 'none';
            redrawMapOverlay();
            alert('Settings saved successfully!');
        });

        document.getElementById('resetSettingsBtn').addEventListener('click', () => {
            if (confirm('Are you sure you want to reset all settings to defaults?')) {
                settings = { ...DEFAULT_SETTINGS };
                saveSettings(settings);
                document.getElementById('attackModeToggle').checked = settings.attackModeEnabled;
                document.getElementById('daysToIgnoreInput').value = settings.daysToIgnore;
                document.getElementById('color0_10k').value = settings.colors.range0_10k;
                document.getElementById('color10_20k').value = settings.colors.range10_20k;
                document.getElementById('color20_50k').value = settings.colors.range20_50k;
                document.getElementById('color50_100k').value = settings.colors.range50_100k;
                document.getElementById('color100kPlus').value = settings.colors.range100kPlus;
                document.getElementById('colorNoData').value = settings.colors.noData;
                alert('Settings reset to defaults!');
            }
        });

        document.getElementById('closeSettingsBtn').addEventListener('click', () => {
            panel.style.display = 'none';
        });

        return panel;
    }

    // Create settings button
    function createSettingsButton() {
        const button = document.createElement('button');
        button.id = 'twIntelSettingsBtn';
        button.textContent = '⚙️ Intel Settings';
        button.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            z-index: 9999;
            padding: 10px 15px;
            background: #7d510f;
            color: white;
            border: 2px solid #5a3a0a;
            cursor: pointer;
            font-weight: bold;
            border-radius: 5px;
            font-family: Verdana, Arial, sans-serif;
        `;

        button.addEventListener('click', () => {
            const panel = document.getElementById('twIntelSettingsPanel');
            if (panel) {
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            }
        });

        document.body.appendChild(button);
        return button;
    }

    // Mock data for demonstration (replace with actual data fetching)
    let villageIntelData = [];

    // Fetch village intel data from database or API
    function fetchVillageIntelData() {
        // ⚠️ INTEGRATION REQUIRED ⚠️
        // This is a placeholder - in a real implementation, this would fetch from:
        // 1. Database API endpoint (e.g., fetch('/api/village-intel'))
        // 2. Local storage (localStorage.getItem('villageIntel'))
        // 3. IndexedDB or other data source
        //
        // Expected data structure:
        // [
        //   {
        //     village_id: 123,
        //     x: 500,
        //     y: 500,
        //     pop_survivors: 5000,
        //     updated_at: '2026-01-10T12:00:00Z'
        //   },
        //   ...
        // ]
        
        // For now, return empty array - this should be replaced with actual data fetching
        return [];
    }

    // Install map overlay hook
    function installMapOverlayHook() {
        console.log('Installing Tribal Wars Intel Overlay...');
        
        // Check if TWMap exists (Tribal Wars map object)
        if (typeof TWMap === 'undefined') {
            console.warn('TWMap not found, retrying in 1 second...');
            setTimeout(installMapOverlayHook, 1000);
            return;
        }

        // Fetch initial data
        villageIntelData = fetchVillageIntelData();
        
        // Hook into map drawing
        const originalMapHandler = TWMap.mapHandler;
        if (originalMapHandler) {
            TWMap.mapHandler = function() {
                originalMapHandler.apply(this, arguments);
                redrawMapOverlay();
            };
        }

        // Initial draw
        redrawMapOverlay();
        
        console.log('Tribal Wars Intel Overlay installed successfully!');
    }

    // Redraw map overlay with current settings
    function redrawMapOverlay() {
        console.log('Redrawing map overlay...');
        
        // Filter data based on settings
        const filteredData = filterRecentData(villageIntelData, settings.daysToIgnore);
        
        // Apply colors to villages on the map
        filteredData.forEach(village => {
            const color = getColorForPopulation(village.pop_survivors);
            applyVillageColor(village, color);
        });

        // If attack mode is enabled, apply additional visual indicators
        if (settings.attackModeEnabled) {
            applyAttackModeIndicators(filteredData);
        }
    }

    // Apply color to a village on the map
    function applyVillageColor(village, color) {
        // ⚠️ INTEGRATION REQUIRED ⚠️
        // This function uses placeholder selectors that need to be updated
        // to match the actual Tribal Wars DOM structure.
        //
        // To integrate:
        // 1. Inspect the Tribal Wars map in browser DevTools
        // 2. Find the actual selectors for village elements
        // 3. Update the selectors below accordingly
        //
        // Common patterns might be:
        // - .village, .map-village, .village-marker
        // - #map_village_123 (where 123 is village_id)
        // - Elements with data-villageid, data-coords, etc.
        
        // Sanitize village ID to prevent CSS selector injection
        const villageId = String(village.village_id).replace(/[^a-zA-Z0-9_-]/g, '');
        const villageElement = document.querySelector(`[data-id="${villageId}"]`);
        if (villageElement) {
            villageElement.style.backgroundColor = color;
            villageElement.style.opacity = '0.7';
        }
        
        // Alternative: find by coordinates (validate as numbers)
        const x = parseInt(village.x, 10);
        const y = parseInt(village.y, 10);
        if (!isNaN(x) && !isNaN(y)) {
            const coordElement = document.querySelector(`[data-x="${x}"][data-y="${y}"]`);
            if (coordElement) {
                coordElement.style.backgroundColor = color;
                coordElement.style.opacity = '0.7';
            }
        }
    }

    // Apply attack mode visual indicators
    function applyAttackModeIndicators(villages) {
        console.log('Applying attack mode indicators to', villages.length, 'villages');
        
        // Attack mode could highlight villages differently, add borders, etc.
        villages.forEach(village => {
            // Sanitize village ID to prevent CSS selector injection
            const villageId = String(village.village_id).replace(/[^a-zA-Z0-9_-]/g, '');
            const x = parseInt(village.x, 10);
            const y = parseInt(village.y, 10);
            
            let villageElement = document.querySelector(`[data-id="${villageId}"]`);
            if (!villageElement && !isNaN(x) && !isNaN(y)) {
                villageElement = document.querySelector(`[data-x="${x}"][data-y="${y}"]`);
            }
            
            if (villageElement) {
                // Add red border for attack mode
                villageElement.style.border = '2px solid red';
                villageElement.style.boxShadow = '0 0 5px red';
            }
        });
    }

    // Initialize the script
    function init() {
        console.log('Tribal Wars Intel Overlay v1.0.0 initializing...');
        
        // Wait for page to be fully loaded
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
            return;
        }

        // Create UI elements
        createSettingsPanel();
        createSettingsButton();

        // Install map overlay hook
        installMapOverlayHook();
        
        console.log('Intel Overlay initialized. Attack Mode:', settings.attackModeEnabled);
    }

    // Start the script
    init();

})();
