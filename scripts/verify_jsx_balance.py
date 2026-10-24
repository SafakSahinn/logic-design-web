import re

def check_balance(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        text = f.read()

    idx_return = text.find('return (')
    jsx_text = text[idx_return:]

    # Remove strings and comments
    # Simple regex for comments {/* ... */}
    clean = re.sub(r'\{/\*.*?\*/\}', '', jsx_text, flags=re.DOTALL)
    print("Length of cleaned JSX:", len(clean))

check_balance(r"C:\Users\safak\Desktop\Logic Design Studio\src\components\LogisimSimulator.tsx")
