const express = require('express');
const ytSearch = require('yt-search');
const { spawn } = require('child_process');

const app = express();
// Lắng nghe cổng dynamic do Render cấp phát (hoặc 3000 khi chạy local)
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// Helper kiểm tra đường dẫn URL
function isYouTubeUrl(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/i.test(url);
}

// Tham số vượt rào kiểm tra Bot của YouTube trên Cloud Hosting
const BYPASS_BOT_ARGS = [
  '--extractor-args', 'youtube:player_client=ios,mweb,android',
  '--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
];

// API Phân tích Link hoặc Tìm kiếm từ khóa
app.get('/api/parse', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Thiếu thông tin tìm kiếm/URL' });

  try {
    if (isYouTubeUrl(query)) {
      const args = [
        '-j', 
        '--flat-playlist', 
        ...BYPASS_BOT_ARGS, 
        query
      ];

      const ytdlp = spawn('yt-dlp', args);
      let stdoutData = '';

      ytdlp.stdout.on('data', (data) => stdoutData += data.toString());
      
      ytdlp.on('close', (code) => {
        if (code !== 0 || !stdoutData) {
          return res.status(400).json({ error: 'Không thể phân tích đường dẫn YouTube này.' });
        }

        const lines = stdoutData.trim().split('\n');
        if (lines.length > 1) {
          const items = lines.map(line => {
            const item = JSON.parse(line);
            return {
              id: item.id,
              url: `https://www.youtube.com/watch?v=${item.id}`,
              title: item.title,
              thumbnail: item.thumbnails ? item.thumbnails[0]?.url : `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
              duration: item.duration ? `${Math.floor(item.duration / 60)}:${item.duration % 60}` : '--:--',
              author: item.uploader || item.channel || 'YouTube'
            };
          });
          return res.json({ type: 'playlist', items });
        } else {
          const info = JSON.parse(lines[0]);
          return res.json({
            type: 'video',
            video: {
              id: info.id,
              url: info.webpage_url || `https://www.youtube.com/watch?v=${info.id}`,
              title: info.title,
              thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`,
              duration: info.duration ? `${Math.floor(info.duration / 60)}:${info.duration % 60}` : '--:--',
              author: info.uploader || info.channel || 'YouTube'
            }
          });
        }
      });
    } else {
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
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi hệ thống khi xử lý dữ liệu.' });
  }
});

// API Tải MP3/MP4
app.get('/api/download', (req, res) => {
  const { url, format, quality, startTime, endTime } = req.query;
  if (!url) return res.status(400).send('Thiếu URL video');

  const isMp3 = format === 'mp3';
  const ext = isMp3 ? 'mp3' : 'mp4';
  const contentType = isMp3 ? 'audio/mpeg' : 'video/mp4';

  res.setHeader('Content-Disposition', `attachment; filename="media_${Date.now()}.${ext}"`);
  res.setHeader('Content-Type', contentType);

  const args = [...BYPASS_BOT_ARGS];

  if (isMp3) {
    args.push('-x', '--audio-format', 'mp3');
    if (quality === '128k') {
      args.push('--audio-quality', '5');
    } else {
      args.push('--audio-quality', '0');
    }
    args.push('--embed-thumbnail', '--add-metadata');
  } else {
    let formatFilter = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best';
    if (quality === '1080p') {
      formatFilter = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best';
    } else if (quality === '480p') {
      formatFilter = 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best';
    }
    args.push('-f', formatFilter);
  }

  if (startTime || endTime) {
    const start = startTime || '00:00:00';
    const end = endTime || '99:59:59';
    args.push('--download-sections', `*${start}-${end}`);
  }

  args.push('-o', '-', url);

  const ytdlp = spawn('yt-dlp', args);

  ytdlp.stdout.pipe(res);

  ytdlp.stderr.on('data', (data) => console.log(`[yt-dlp]: ${data.toString().trim()}`));
  ytdlp.on('close', (code) => {
    if (code !== 0) console.error(`Xử lý tải lỗi với mã: ${code}`);
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy trên cổng ${PORT}`);
});