import sys,subprocess,io
from PIL import Image
A=sys.argv[1]; x,y=int(sys.argv[2]),int(sys.argv[3])
png=subprocess.run([A,"exec-out","screencap","-p"],capture_output=True).stdout
print("#%02X%02X%02X"%Image.open(io.BytesIO(png)).convert("RGB").getpixel((x,y))[:3])
