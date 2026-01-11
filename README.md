# Tribal Wars Intel Overlay Script

A custom userscript for Tribal Wars that provides an intelligent village overlay system with population-based coloring and attack mode features.

## Features

### 1. **Attack Mode Toggle**
- Enable/disable attack mode to highlight villages with special indicators
- When enabled, villages are marked with red borders and shadows for easy identification

### 2. **Population-Based Color Mapping**
The script automatically colors villages based on their survivor population (`pop_survivors`):
- **0k - 10k**: Green (default: `#00FF00`)
- **10k - 20k**: Light Blue (default: `#ADD8E6`)
- **20k - 50k**: Yellow (default: `#FFFF00`)
- **50k - 100k**: Light Red (default: `#FFB6C1`)
- **100k+**: Dark Red (default: `#8B0000`)
- **Missing Information**: Gray (default: `#808080`)

### 3. **Customizable Colors**
- Full customization of all color ranges through an intuitive settings panel
- Color changes are saved automatically to persistent storage
- Reset to defaults option available

### 4. **Recent Reports Filter**
- "Days to ignore note" field (default: 3 days)
- Filters out intelligence reports older than the specified number of days
- Based on the `updated_at` field from the `tw_village_intel_latest` table

## Installation

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Safari, Edge)
   - [Greasemonkey](https://www.greasespot.net/) (Firefox)
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Firefox, Edge)

2. Click on the raw file link for `tribalwars-intel-overlay.user.js`

3. Your userscript manager should prompt you to install the script

4. Navigate to any Tribal Wars game page to see the overlay in action

## Usage

### Accessing Settings
1. Look for the **⚙️ Intel Settings** button in the top-right corner of the game
2. Click to open the settings panel

### Configuring the Script
- **Enable Attack Mode**: Check/uncheck to toggle attack mode
- **Days to ignore notes**: Set how many days of history to include (0-365)
- **Population Color Ranges**: Click on any color picker to customize colors
- **Save**: Apply and save your changes
- **Reset to Defaults**: Restore all settings to default values
- **Cancel**: Close without saving changes

### How It Works
1. The script fetches village intelligence data from the `tw_village_intel_latest` table
2. Data is filtered based on the "days to ignore" setting using the `updated_at` field
3. Villages are colored on the map according to their `pop_survivors` value
4. If attack mode is enabled, additional visual indicators are applied
5. The overlay automatically updates when you navigate the map

## Technical Details

### Data Schema
The script expects data from `tw_village_intel_latest` with the following columns:
- `village_id`: Unique identifier for the village
- `x`, `y`: Village coordinates
- `pop_survivors`: Population count (used for color classification)
- `updated_at`: Timestamp of last update (ISO 8601 format)

### Storage
Settings are stored using GM_setValue/GM_getValue for persistence across sessions:
- `attackModeEnabled`: Boolean
- `daysToIgnore`: Number (0-365)
- `colors`: Object with color hex codes for each range

### Functions
- `installMapOverlayHook()`: Initializes the overlay system and hooks into the map
- `redrawMapOverlay()`: Redraws the overlay with current settings
- `getColorForPopulation(pop)`: Returns the appropriate color for a population value
- `filterRecentData(data, days)`: Filters data based on the days threshold
- `applyVillageColor(village, color)`: Applies color to a village on the map
- `applyAttackModeIndicators(villages)`: Adds attack mode visual indicators

## Customization

### Extending Population Ranges
To add custom population ranges, modify the `getColorForPopulation()` function:

```javascript
function getColorForPopulation(population) {
    // Add your custom ranges here
    if (pop < 5000) {
        return '#CUSTOM_COLOR';
    }
    // ... existing ranges
}
```

### Custom Attack Mode Behavior
Modify the `applyAttackModeIndicators()` function to change how attack mode highlights villages:

```javascript
function applyAttackModeIndicators(villages) {
    villages.forEach(village => {
        // Custom highlighting logic
    });
}
```

## Compatibility
- Designed for Tribal Wars (all versions)
- Requires a modern browser with userscript support
- Compatible with Tampermonkey, Greasemonkey, and Violentmonkey

## Version History
- **v1.0.0**: Initial release
  - Attack mode toggle
  - Population-based coloring
  - Customizable color ranges
  - Recent reports filter

## License
This script is provided as-is for personal use with Tribal Wars.

## Contributing
Feel free to fork and submit pull requests for improvements or bug fixes.

## Support
For issues or feature requests, please open an issue on GitHub.