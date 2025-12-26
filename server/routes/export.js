import express from 'express';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Export transcription in various formats
router.post('/:format', async (req, res) => {
  try {
    const { format } = req.params;
    const { transcription, title = 'Transcription' } = req.body;

    if (!transcription) {
      return res.status(400).json({ error: 'Transcription text is required' });
    }

    const tempDir = join(__dirname, '../../temp');
    await fs.mkdir(tempDir, { recursive: true });

    let filePath;
    let contentType;
    let fileName;

    switch (format.toLowerCase()) {
      case 'txt':
        filePath = join(tempDir, `${Date.now()}.txt`);
        await fs.writeFile(filePath, transcription, 'utf-8');
        contentType = 'text/plain';
        fileName = `${title}.txt`;
        break;

      case 'docx':
        const doc = new Document({
          sections: [{
            properties: {},
            children: transcription.split('\n').map(line => 
              new Paragraph({
                children: [new TextRun(line || ' ')]
              })
            )
          }]
        });

        filePath = join(tempDir, `${Date.now()}.docx`);
        const buffer = await Packer.toBuffer(doc);
        await fs.writeFile(filePath, buffer);
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        fileName = `${title}.docx`;
        break;

      case 'pdf':
        const pdfDoc = await PDFDocument.create();
        let page = pdfDoc.addPage([595, 842]); // A4 size
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontSize = 12;
        const margin = 50;
        const maxWidth = page.getWidth() - 2 * margin;
        
        let y = page.getHeight() - margin;
        const lines = transcription.split('\n');
        
        for (const line of lines) {
          if (y < margin + fontSize) {
            page = pdfDoc.addPage([595, 842]);
            y = page.getHeight() - margin;
          }
          
          page.drawText(line, {
            x: margin,
            y: y,
            size: fontSize,
            font: font,
            maxWidth: maxWidth,
            color: rgb(0, 0, 0)
          });
          
          y -= fontSize + 5;
        }

        const pdfBytes = await pdfDoc.save();
        filePath = join(tempDir, `${Date.now()}.pdf`);
        await fs.writeFile(filePath, pdfBytes);
        contentType = 'application/pdf';
        fileName = `${title}.pdf`;
        break;

      case 'json':
        const jsonData = {
          title: title,
          transcription: transcription,
          exportedAt: new Date().toISOString()
        };
        filePath = join(tempDir, `${Date.now()}.json`);
        await fs.writeFile(filePath, JSON.stringify(jsonData, null, 2), 'utf-8');
        contentType = 'application/json';
        fileName = `${title}.json`;
        break;

      case 'srt':
        // Simple SRT format (can be enhanced with timestamps from segments)
        const srtContent = `1\n00:00:00,000 --> 00:00:10,000\n${transcription.replace(/\n/g, '\n\n')}`;
        filePath = join(tempDir, `${Date.now()}.srt`);
        await fs.writeFile(filePath, srtContent, 'utf-8');
        contentType = 'text/srt';
        fileName = `${title}.srt`;
        break;

      case 'vtt':
        const vttContent = `WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n${transcription.replace(/\n/g, '\n\n')}`;
        filePath = join(tempDir, `${Date.now()}.vtt`);
        await fs.writeFile(filePath, vttContent, 'utf-8');
        contentType = 'text/vtt';
        fileName = `${title}.vtt`;
        break;

      default:
        return res.status(400).json({ error: `Unsupported format: ${format}` });
    }

    // Send file and clean up after a delay
    res.download(filePath, fileName, async (err) => {
      if (err) {
        console.error('Download error:', err);
      }
      // Clean up after download
      setTimeout(async () => {
        await fs.unlink(filePath).catch(() => {});
      }, 5000);
    });

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      error: 'Export failed',
      message: error.message
    });
  }
});

export default router;

