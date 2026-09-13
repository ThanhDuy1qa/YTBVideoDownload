FROM node:20-slim

# Cài đặt FFmpeg, Python3 và yt-dlp vào hệ thống
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && pip install --break-system-packages --upgrade yt-dlp || pip install --upgrade yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Thiết lập thư mục làm việc
WORKDIR /app

# Sao chép file cấu hình và cài đặt package Node
COPY package*.json ./
RUN npm install --production

# Sao chép toàn bộ mã nguồn
COPY . .

# Mở cổng 3000
EXPOSE 3000

# Khởi chạy server
CMD ["node", "server.js"]