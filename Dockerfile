# Đổi từ node:18-slim sang node:20-slim
FROM node:20-slim

# Cài đặt FFmpeg, Python và yt-dlp vào hệ thống cloud
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    && pip install --break-system-packages yt-dlp || pip install yt-dlp

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