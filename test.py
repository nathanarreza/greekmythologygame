import json

def adjust_hp(json_path="characters.json", output_path="characters_updated.json"):
    # Load existing characters JSON
    with open(json_path, "r", encoding="utf-8") as f:
        characters = json.load(f)

    # Adjust HP
    for char in characters:
        if "stats" in char and "HP" in char["stats"]:
            if char["stats"]["HP"] <= 100:
                char["stats"]["HP"] += 50

    # Save updated JSON
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(characters, f, indent=4, ensure_ascii=False)

    print(f"Updated characters saved to {output_path}")

if __name__ == "__main__":
    adjust_hp()
