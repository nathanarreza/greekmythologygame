// Import mammoth for DOCX parsing
import * as mammoth from 'mammoth';

// Function to parse DOCX file and extract character data
async function parseCharactersFromDocx(filePath) {
    try {
        // Read the DOCX file
        const fileBuffer = await window.fs.readFile(filePath);
        
        // Extract text from DOCX using mammoth
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        const documentContent = result.value;
        
        // Log any messages from mammoth (warnings, etc.)
        if (result.messages.length > 0) {
            console.log("Mammoth messages:", result.messages);
        }
        
        // Parse the extracted text
        return parseCharacters(documentContent);
        
    } catch (error) {
        console.error("Error reading or parsing DOCX file:", error);
        return [];
    }
}

// Function to extract character data from text content
function parseCharacters(documentContent) {
    const characters = [];
    
    // Split by character headers (lines starting with ##)
    const sections = documentContent.split(/^## /m).filter(section => section.trim());
    
    sections.forEach(section => {
        try {
            const lines = section.split('\n').map(line => line.trim()).filter(line => line);
            
            // Extract character name and basic info
            const titleLine = lines[0];
            const nameMatch = titleLine.match(/\*\*(.+?)\*\*/);
            if (!nameMatch) return;
            
            const fullName = nameMatch[1];
            const name = fullName.replace(/[🌹☀️🎭🔥🪶]/g, '').trim();
            const id = name.toUpperCase().replace(/\s+/g, '_');
            
            // Check if can fly
            const canFlyLine = lines.find(line => line.includes('Can Fly') || line.includes('Cannot Fly'));
            const canFly = canFlyLine ? canFlyLine.includes('✅') || canFlyLine.includes('Can Fly') : false;
            
            // Extract stats
            let stats = { HP: 0, STR: 0, MAG: 0, WIS: 0 };
            
            // Find Physical Strength
            const strLine = lines.find(line => line.includes('Physical Strength'));
            if (strLine) {
                const strMatch = strLine.match(/(\d+)/);
                if (strMatch) stats.STR = parseInt(strMatch[1]);
            }
            
            // Find Wisdom
            const wisLine = lines.find(line => line.includes('Wisdom') && !line.includes('Passive'));
            if (wisLine) {
                const wisMatch = wisLine.match(/(\d+)/);
                if (wisMatch) stats.WIS = parseInt(wisMatch[1]);
            }
            
            // Find Magical Power
            const magLine = lines.find(line => line.includes('Magical Power'));
            if (magLine) {
                const magMatch = magLine.match(/(\d+)/);
                if (magMatch) stats.MAG = parseInt(magMatch[1]);
            }
            
            // Find HP
            const hpLine = lines.find(line => line.includes('HP') && !line.includes('damage') && !line.includes('Passive'));
            if (hpLine) {
                const hpMatch = hpLine.match(/(\d+)/);
                if (hpMatch) stats.HP = parseInt(hpMatch[1]);
            }
            
            // Extract passive skill
            let passive = { name: '', text: '' };
            const passiveIndex = lines.findIndex(line => line.includes('Passive Skill'));
            if (passiveIndex !== -1) {
                const passiveLine = lines[passiveIndex];
                const passiveNameMatch = passiveLine.match(/--\s*(.+?)$/);
                if (passiveNameMatch) {
                    passive.name = passiveNameMatch[1].replace(/\*+/g, '').trim();
                }
                
                // Collect passive description
                let passiveText = [];
                for (let i = passiveIndex + 1; i < lines.length; i++) {
                    if (lines[i].includes('Attacks and Abilities') || lines[i].match(/^\*\*\d+\./)) break;
                    if (lines[i] && !lines[i].includes('**🌀') && !lines[i].includes('**🎭')) {
                        passiveText.push(lines[i].replace(/-\s+\*/g, '').replace(/\*/g, '').trim());
                    }
                }
                passive.text = passiveText.join(' ').trim();
            }
            
            // Extract abilities
            const abilities = [];
            const abilityRegex = /\*\*(\d+)\.\s*(.*?)\*\*\s*--\s*\*Power:\s*(\d+)/g;
            let match;
            
            while ((match = abilityRegex.exec(section)) !== null) {
                const abilityNum = match[1];
                let abilityName = match[2].trim();
                const power = parseInt(match[3]);
                
                // Clean up ability name
                abilityName = abilityName.replace(/[🔥⚡🌙🎭💫]/g, '').trim();
                
                // Extract ability description
                const abilityStart = section.indexOf(match[0]);
                const nextAbilityMatch = abilityRegex.exec(section);
                let abilityEnd;
                if (nextAbilityMatch) {
                    abilityEnd = section.indexOf(nextAbilityMatch[0]);
                    // Reset regex
                    abilityRegex.lastIndex = section.indexOf(nextAbilityMatch[0]);
                } else {
                    abilityEnd = section.length;
                }
                
                const abilitySection = section.substring(abilityStart, abilityEnd);
                const abilityLines = abilitySection.split('\n');
                let effectText = [];
                
                for (let line of abilityLines) {
                    line = line.trim();
                    if (line.startsWith('*Effect*:') || line.startsWith('-   *Effect*:')) {
                        effectText.push(line.replace(/^-?\s*\*Effect\*:\s*/, '').replace(/\*/g, '').trim());
                    } else if (line.startsWith('-') && !line.includes('*Effect*:') && effectText.length > 0) {
                        effectText.push(line.replace(/^-\s*/, '').replace(/\*/g, '').trim());
                    }
                }
                
                const ability = {
                    id: `${id}_AB${abilityNum}`,
                    name: abilityName,
                    power: power,
                    type: stats.MAG > stats.STR ? "magical" : "physical",
                    text: effectText.join(' ').trim()
                };
                
                abilities.push(ability);
            }
            
            // Only add character if they have valid stats
            if (stats.HP > 0 && stats.STR > 0 && abilities.length > 0) {
                const character = {
                    id: id,
                    name: name,
                    canFly: canFly,
                    stats: stats,
                    passive: passive,
                    abilities: abilities
                };
                
                characters.push(character);
            }
            
        } catch (error) {
            console.log(`Error parsing character: ${error.message}`);
        }
    });
    
    return characters;
}

// Usage example
async function main() {
    try {
        // Replace 'your-file.docx' with the actual filename
        const filePath = 'your-file.docx';
        
        const characters = await parseCharactersFromDocx(filePath);
        
        console.log("Parsed Characters:");
        characters.forEach(char => {
            console.log(`${char.name}: ${char.abilities.length} abilities, HP: ${char.stats.HP}`);
        });
        
        console.log(`\nTotal characters parsed: ${characters.length}`);
        console.log("\nJSON output:");
        console.log(JSON.stringify(characters, null, 2));
        
        return characters;
        
    } catch (error) {
        console.error("Main execution error:", error);
        return [];
    }
}

// Alternative function if you want to handle file input differently
async function parseFromFileInput(fileInput) {
    try {
        const file = fileInput.files[0];
        if (!file) {
            console.error("No file selected");
            return [];
        }
        
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        const documentContent = result.value;
        
        return parseCharacters(documentContent);
        
    } catch (error) {
        console.error("Error parsing file input:", error);
        return [];
    }
}

// Run the main function
main();