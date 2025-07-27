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
function createPDF(content, title, isQuestionPaper = false) {
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

            // Add header
            doc.fontSize(18).font('Helvetica-Bold');
            doc.text(title, { align: 'center' });
            doc.moveDown(1);
            
            // Add a line separator
            doc.moveTo(50, doc.y)
               .lineTo(545, doc.y)
               .stroke();
            doc.moveDown(1);

            // Process content
            doc.fontSize(12).font('Helvetica');
            const lines = content.split('\n');
            
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
                    } else if (line.startsWith('###')) {
                        // Sub-headings
                        doc.fontSize(13).font('Helvetica-Bold');
                        doc.text(line.replace(/###/g, '').trim(), { align: 'left' });
                        doc.moveDown(0.3);
                        doc.fontSize(12).font('Helvetica');
                    } else if (line.startsWith('##')) {
                        // Main headings
                        doc.fontSize(15).font('Helvetica-Bold');
                        doc.text(line.replace(/##/g, '').trim(), { align: 'left' });
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
                    } else if (line.includes('Question') && /\d+/.test(line) && isQuestionPaper) {
                        // Question numbering for question papers
                        doc.fontSize(13).font('Helvetica-Bold');
                        doc.text(line, { align: 'left' });
                        doc.moveDown(0.2);
                        doc.fontSize(12).font('Helvetica');
                    } else if (line.toLowerCase().includes('marks:') || line.toLowerCase().includes('[') && line.toLowerCase().includes('marks')) {
                        // Mark allocation
                        doc.fontSize(10).font('Helvetica-Oblique');
                        doc.text(line, { align: 'right' });
                        doc.moveDown(0.3);
                        doc.fontSize(12).font('Helvetica');
                    } else {
                        // Regular text
                        doc.text(line, { align: 'left' });
                    }
                    doc.moveDown(0.3);
                    
                    // Add page break if content is getting too long
                    if (doc.y > 700) {
                        doc.addPage();
                    }
                }
            });

            // Add footer
            const pages = doc.bufferedPageRange();
            for (let i = 0; i < pages.count; i++) {
                doc.switchToPage(i);
                doc.fontSize(10).font('Helvetica');
                doc.text(`Page ${i + 1} of ${pages.count}`, 50, 750, { align: 'center' });
            }

            doc.end();
            
        } catch (error) {
            reject(error);
        }
    });
}

// Helper function to split content into notes and questions
function splitContent(content) {
    // Look for section markers
    const sections = content.split(/\*\*Section \d+:/i);
    
    let notesContent = '';
    let questionsContent = '';
    
    if (sections.length > 1) {
        // Find notes section
        const notesSection = sections.find(section => 
            section.toLowerCase().includes('notes') || 
            sections.indexOf(section) === 1
        );
        
        // Find questions section
        const questionsSection = sections.find(section => 
            section.toLowerCase().includes('question') || 
            section.toLowerCase().includes('paper') ||
            sections.indexOf(section) === 2
        );
        
        notesContent = notesSection ? notesSection.trim() : '';
        questionsContent = questionsSection ? questionsSection.trim() : '';
    } else {
        // Fallback: try to split by keywords
        const contentLines = content.split('\n');
        let isInQuestionsSection = false;
        let notesLines = [];
        let questionsLines = [];
        
        contentLines.forEach(line => {
            const lowerLine = line.toLowerCase();
            if (lowerLine.includes('question paper') || 
                lowerLine.includes('practice questions') ||
                lowerLine.includes('section 2')) {
                isInQuestionsSection = true;
                questionsLines.push(line);
            } else if (isInQuestionsSection) {
                questionsLines.push(line);
            } else {
                notesLines.push(line);
            }
        });
        
        notesContent = notesLines.join('\n').trim();
        questionsContent = questionsLines.join('\n').trim();
    }
    
    return { notesContent, questionsContent };
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
        Generate comprehensive study notes for the specified topic, suitable for the given grade level. Structure the notes logically with clear headings and subheadings using ## for main headings and ### for sub-headings. Ensure the content covers key concepts, definitions, formulas (if applicable), and important examples. Use bullet points with * or - for lists.

        **Section 2: Question Paper**
        Create a practice question paper based on the notes and topic. Include a variety of question types if specified (${format}). Ensure the difficulty is appropriate for the grade level. Provide clear instructions and allocate marks for each question using [X marks] format. Include an answer key at the very end of this section. Number each question clearly (Question 1, Question 2, etc.).
        ---
        
        Format your response with clear markdown-style headings and structure.
        `;

        // Make the API call to Claude
        const response = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 4000,
            messages: [{
                role: "user",
                content: prompt
            }]
        });

        // Extract the generated text from Claude's response
        const generatedContent = response.content[0].text;

        // Split content into notes and questions
        const { notesContent, questionsContent } = splitContent(generatedContent);

        if (!notesContent || !questionsContent) {
            return res.status(500).json({ error: 'Failed to properly separate notes and questions content.' });
        }

        // Generate separate PDFs
        const notesFilename = `${subject}_${topic}_Grade${grade}_Notes.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
        const questionsFilename = `${subject}_${topic}_Grade${grade}_Questions.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');

        const notesPdfBuffer = await createPDF(
            notesContent, 
            `${subject} - ${topic} Study Notes (Grade ${grade})`,
            false
        );
        
        const questionsPdfBuffer = await createPDF(
            questionsContent, 
            `${subject} - ${topic} Practice Questions (Grade ${grade})`,
            true
        );

        // Convert PDF buffers to base64 for email attachment
        const notesPdfBase64 = notesPdfBuffer.toString('base64');
        const questionsPdfBase64 = questionsPdfBuffer.toString('base64');

        // Send the generated content and PDFs back to the frontend
        res.status(200).json({
            message: 'Content generated successfully!',
            generatedText: generatedContent,
            notesPdf: {
                data: notesPdfBase64,
                filename: notesFilename
            },
            questionsPdf: {
                data: questionsPdfBase64,
                filename: questionsFilename
            }
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
