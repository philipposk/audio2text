// Export functionality for Vercel serverless
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { format, transcription, title = 'Transcription' } = req.body;

    if (!transcription) {
      return res.status(400).json({ error: 'Transcription text is required' });
    }

    let buffer;
    let contentType;
    let fileName;

    switch (format.toLowerCase()) {
      case 'txt':
        buffer = Buffer.from(transcription, 'utf-8');
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
        buffer = await Packer.toBuffer(doc);
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        fileName = `${title}.docx`;
        break;

      case 'pdf':
        const pdfDoc = await PDFDocument.create();
        let page = pdfDoc.addPage([595, 842]);
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

        buffer = Buffer.from(await pdfDoc.save());
        contentType = 'application/pdf';
        fileName = `${title}.pdf`;
        break;

      case 'json':
        const jsonData = {
          title: title,
          transcription: transcription,
          exportedAt: new Date().toISOString()
        };
        buffer = Buffer.from(JSON.stringify(jsonData, null, 2), 'utf-8');
        contentType = 'application/json';
        fileName = `${title}.json`;
        break;

      case 'srt':
        const srtContent = `1\n00:00:00,000 --> 00:00:10,000\n${transcription.replace(/\n/g, '\n\n')}`;
        buffer = Buffer.from(srtContent, 'utf-8');
        contentType = 'text/srt';
        fileName = `${title}.srt`;
        break;

      case 'vtt':
        const vttContent = `WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n${transcription.replace(/\n/g, '\n\n')}`;
        buffer = Buffer.from(vttContent, 'utf-8');
        contentType = 'text/vtt';
        fileName = `${title}.vtt`;
        break;

      default:
        return res.status(400).json({ error: `Unsupported format: ${format}` });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(buffer);
  } catch (error) {
    console.error('Export error:', error);
    return res.status(500).json({
      error: 'Export failed',
      message: error.message
    });
  }
}
