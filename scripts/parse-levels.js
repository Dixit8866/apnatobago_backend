import fs from 'fs';
import path from 'path';

const csvPath = 'C:\\Users\\Admin\\Downloads\\custom_levels.csv';
const jsonPath = 'D:\\Majesticai\\tobaco\\backend\\scripts\\custom_levels.json';

try {
    if (!fs.existsSync(csvPath)) {
        console.error(`CSV file not found at ${csvPath}`);
        process.exit(1);
    }

    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');
    
    // Simple CSV parser for quoted fields
    const parseCSVLine = (line) => {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result.map(val => val === 'NULL' || val === '' ? null : val);
    };

    const headers = parseCSVLine(lines[0]);
    const jsonArray = [];

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < headers.length) continue;
        
        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = values[index];
        });
        jsonArray.push(obj);
    }

    fs.writeFileSync(jsonPath, JSON.stringify(jsonArray, null, 4), 'utf8');
    console.log(`Successfully converted CSV to JSON. Saved at: ${jsonPath}`);
    console.log(JSON.stringify(jsonArray, null, 2));
} catch (error) {
    console.error('Error parsing CSV:', error);
}
