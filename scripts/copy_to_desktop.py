import os
import shutil

src = r"C:\Users\safak\Desktop\Logic Deisgn Web Site"
dst = r"C:\Users\safak\Desktop\Logic Design Studio"
alt = r"C:\Users\safak\Desktop\Logis Design Studio"

os.makedirs(dst, exist_ok=True)

ignored = {"node_modules", "dist_electron", "dist", ".git"}

for root, dirs, files in os.walk(src):
    # filter out ignored dirs
    dirs[:] = [d for d in dirs if d not in ignored]
    rel = os.path.relpath(root, src)
    target_root = os.path.join(dst, rel)
    os.makedirs(target_root, exist_ok=True)
    for f in files:
        src_file = os.path.join(root, f)
        dst_file = os.path.join(target_root, f)
        shutil.copy2(src_file, dst_file)

print(f"Copied all project files to: {dst}")

# Create junction or symlink for Logis Design Studio if not exists
if not os.path.exists(alt):
    try:
        import subprocess
        subprocess.run(["cmd", "/c", "mklink", "/J", alt, dst], check=True)
        print(f"Created junction at: {alt}")
    except Exception as e:
        print(f"Junction notice: {e}")
