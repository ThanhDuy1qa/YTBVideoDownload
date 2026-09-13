const express = require('express');
const ytSearch = require('yt-search');
const { spawn } = require('child_process');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// Helper bóc tách Video ID từ URL YouTube
function getYouTubeVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// ==========================================
// 1. API Tìm kiếm từ khóa (yt-search)
// ==========================================
app.get('/api/parse', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Thiếu thông tin tìm kiếm' });

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const r = await ytSearch(query);
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const videos = r.videos.slice(startIndex, endIndex).map(v => ({
      id: v.videoId,
      url: v.url,
      title: v.title,
      thumbnail: v.thumbnail,
      duration: v.timestamp,
      author: v.author.name
    }));

    res.json({ type: 'search', videos, hasMore: endIndex < r.videos.length });
  } catch (err) {
    console.error('Lỗi search:', err);
    res.status(500).json({ error: 'Lỗi hệ thống khi tìm kiếm dữ liệu.' });
  }
});

// ==========================================
// 2. API Tải Xuống Trực Tiếp Bằng yt-dlp
// ==========================================
app.get('/api/download', (req, res) => {
  const { url, format, quality } = req.query;
  if (!url) return res.status(400).send('Thiếu URL video');

  const videoId = getYouTubeVideoId(url);
  if (!videoId) return res.status(400).send('URL YouTube không hợp lệ');

  const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const isMp3 = format === 'mp3';

  // Đặt header hỗ trợ tải file trực tiếp trên Điện thoại & Máy tính
  const ext = isMp3 ? 'mp3' : 'mp4';
  const filename = `youtube_${videoId}.${ext}`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', isMp3 ? 'audio/mpeg' : 'video/mp4');

  // Chuẩn bị tham số cho yt-dlp
  let args = [];
  if (isMp3) {
    const audioQuality = quality === '320k' ? '0' : '5'; // 0: VBR cao nhất (~320k), 5: trung bình (~128k)
    args = [
      '-f', 'bestaudio/best',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', audioQuality,
      '-o', '-', // Đưa dữ liệu ra stdout để stream
      targetUrl
    ];
  } else {
    args = [
      '-f', 'best[ext=mp4]/best',
      '-o', '-', // Đưa dữ liệu ra stdout để stream
      targetUrl
    ];
  }

  // Khởi chạy tiến trình yt-dlp (dùng spawn an toàn)
  const ytdlp = spawn('yt-dlp', args);

  // Stream trực tiếp về thiết bị người dùng
  ytdlp.stdout.pipe(res);

  ytdlp.stderr.on('data', (data) => {
    console.error(`yt-dlp log: ${data}`);
  });

  ytdlp.on('error', (err) => {
    console.error('Lỗi khởi chạy yt-dlp:', err);
    if (!res.headersSent) {
      res.status(500).send('Lỗi máy chủ khi xử lý video.');
    }
  });

  ytdlp.on('close', (code) => {
    if (code !== 0) {
      console.error(`yt-dlp kết thúc với mã lỗi: ${code}`);
    }
  });

  // Hủy tiến trình yt-dlp nếu người dùng ngắt kết nối giữa chừng (đóng web/hủy tải)
  req.on('close', () => {
    ytdlp.kill();
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại port ${PORT}`);
});