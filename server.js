// server.js

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// --- CORS Configuration ---
const corsOptions = {
  origin: 'https://tapiso-banks.github.io', // Your EXACT GitHub Pages URL
  methods: ['GET', 'POST'], // Allow both GET and POST requests
  allowedHeaders: ['Content-Type'], // Allow Content-Type header
  optionsSuccessStatus: 200 // For older browsers
};
app.use(cors(corsOptions));

app.use(bodyParser.json());

// Initialize the Anthropic client
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// Helper function to create PDF from text content
function createPDF(content, filename) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                margin: 50,
                size: 'A4'
            });
            
            // Create a buffer to store PDF data
            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(chunks);
                resolve(pdfBuffer);
            });
            doc.on('error', reject);

            // Add title styling
            doc.fontSize(16).font('Helvetica-Bold');
            
            // Split content into sections (Notes and Question Paper)
            const sections = content.split(/\*\*Section \d+:/);
            
            if (sections.length > 1) {
                // Process each section
                for (let i = 1; i < sections.length; i++) {
                    const section = sections[i].trim();
                    const lines = section.split('\n');
                    
                    // Add section title
                    if (i === 1) {
                        doc.text('STUDY NOTES', { align: 'center' });
                    } else if (i === 2) {
                        doc.addPage();
                        doc.text('PRACTICE QUESTION PAPER', { align: 'center' });
                    }
                    
                    doc.moveDown(1);
                    doc.fontSize(12).font('Helvetica');
                    
                    // Process each line
                    lines.forEach(line => {
                        line = line.trim();
                        if (line) {
                            // Handle different formatting
                            if (line.startsWith('**') && line.endsWith('**')) {
                                // Bold headings
                                doc.fontSize(14).font('Helvetica-Bold');
                                doc.text(line.replace(/\*\*/g, ''), { align: 'left' });
                                doc.moveDown(0.5);
                                doc.fontSize(12).font('Helvetica');
                            } else if (line.startsWith('*') || line.startsWith('-')) {
                                // Bullet points
                                doc.text(`• ${line.substring(1).trim()}`, {
                                    indent: 20,
                                    align: 'left'
                                });
                            } else if (/^\d+\./.test(line)) {
                                // Numbered items
                                doc.text(line, { align: 'left' });
                            } else {
                                // Regular text
                                doc.text(line, { align: 'left' });
                            }
                            doc.moveDown(0.3);
                        }
                    });
                }
            } else {
                // Fallback: treat as single content block
                doc.text('GENERATED CONTENT', { align: 'center' });
                doc.moveDown(1);
                doc.fontSize(12).font('Helvetica');
                
                const lines = content.split('\n');
                lines.forEach(line => {
                    if (line.trim()) {
                        if (line.startsWith('**') && line.endsWith('**')) {
                            doc.fontSize(14).font('Helvetica-Bold');
                            doc.text(line.replace(/\*\*/g, ''));
                            doc.fontSize(12).font('Helvetica');
                        } else {
                            doc.text(line.trim());
                        }
                        doc.moveDown(0.3);
                    }
                });
            }

            doc.end();
            
        } catch (error) {
            reject(error);
        }
    });
}

app.post('/api/generate', async (req, res) => {
    const { school, grade, subject, topic, format, notes_pages, papers_pages, email } = req.body;

    // Basic validation
    if (!school || !grade || !subject || !topic || !notes_pages || !papers_pages || !email) {
        return res.status(400).json({ error: 'All form fields are required.' });
    }

    try {
        // Construct the prompt for Claude
        const prompt = `
        You are a helpful assistant for students.
        Based on the following request, generate comprehensive notes and a practice question paper.

        Student Request Details:
        School: ${school}
        Grade: ${grade}
        Subject: ${subject}
        Topic: ${topic}
        Desired Notes Length: Approximately ${notes_pages} pages
        Desired Question Paper Length: Approximately ${papers_pages} pages
        Question Paper Formats (if specified): ${format}

        ---
        Please provide the content in two distinct sections:

        **Section 1: Notes**
        Generate comprehensive study notes for the specified topic, suitable for the given grade level. Structure the notes logically with clear headings and subheadings. Ensure the content covers key concepts, definitions, formulas (if applicable), and important examples.

        **Section 2: Question Paper**
        Create a practice question paper based on the notes and topic. Include a variety of question types if specified (${format}). Ensure the difficulty is appropriate for the grade level. Provide clear instructions and allocate marks for each question. Include an answer key at the very end of this section.
        ---
        
        Format your response with clear markdown-style headings using ** for bold text.
        `;

        // Make the API call to Claude
        const response = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022", // Updated to a more recent model
            max_tokens: 4000,
            messages: [{
                role: "user",
                content: prompt
            }]
        });

        // Extract the generated text from Claude's response
        const generatedContent = response.content[0].text;

        // Generate PDF from the content
        const filename = `${subject}_${topic}_Grade${grade}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
        const pdfBuffer = await createPDF(generatedContent, filename);

        // Convert PDF buffer to base64 for email attachment
        const pdfBase64 = pdfBuffer.toString('base64');

        // Send the generated content and PDF back to the frontend
        res.status(200).json({
            message: 'Content generated successfully!',
            generatedText: generatedContent,
            pdfData: pdfBase64,
            filename: filename
        });

    } catch (error) {
        console.error('Error processing request in backend:', error.response ? error.response.data : error.message);
        const errorMessage = error.response && error.response.data && error.response.data.error && error.response.data.error.message
            ? error.response.data.error.message
            : 'Error generating content. Please try again.';
        res.status(500).json({ error: errorMessage });
    }
});

// Simple GET route for health check
app.get('/', (req, res) => {
    res.send('Student Helper Backend is running!');
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
