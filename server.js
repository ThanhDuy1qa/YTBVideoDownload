const express = require('express');
const ytSearch = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public')); // Đảm bảo bạn để file index.html trong thư mục 'public'
app.use(express.json());

// Helper kiểm tra đường dẫn URL
function isYouTubeUrl(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/i.test(url);
}

// API Phân tích Link hoặc Tìm kiếm từ khóa
app.get('/api/parse', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Thiếu thông tin tìm kiếm/URL' });

  try {
    // Nếu là Link trực tiếp, báo frontend hiển thị luôn video (bỏ qua tìm kiếm)
    if (isYouTubeUrl(query)) {
      return res.status(400).json({ error: 'Hãy dán link trực tiếp vào khung tải xuống, không cần tìm kiếm.' });
    }

    // Nếu là từ khóa, dùng yt-search để lấy danh sách video
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
    console.error(err);
    res.status(500).json({ error: 'Lỗi hệ thống khi xử lý dữ liệu tìm kiếm.' });
  }
});

// API Tải MP3/MP4 thông qua Cobalt API
app.get('/api/download', async (req, res) => {
  const { url, format, quality } = req.query;
  if (!url) return res.status(400).send('Thiếu URL video');

  const isMp3 = format === 'mp3';
  
  // Ánh xạ chất lượng video sang chuẩn của Cobalt
  let vQuality = '720';
  if (quality === '1080p') vQuality = '1080';
  if (quality === '480p') vQuality = '480';

  try {
    console.log(`Đang yêu cầu Cobalt xử lý: ${url} | Định dạng: ${isMp3 ? 'MP3' : 'MP4'}`);

    const response = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: url,
        vQuality: vQuality,
        isAudioOnly: isMp3
      })
    });

    const data = await response.json();

    if (data && data.url) {
      // Chuyển hướng thẳng đến file tải về
      return res.redirect(data.url);
    } else {
      console.error('Lỗi từ Cobalt:', data);
      return res.status(500).send('Hệ thống quá tải hoặc link bị giới hạn.');
    }
  } catch (error) {
    console.error('Lỗi hệ thống:', error);
    return res.status(500).send('Lỗi kết nối tới máy chủ tải video.');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy trên cổng ${PORT}`);
});