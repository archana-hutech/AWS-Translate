const AWS = require('aws-sdk');
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
require('dotenv').config(); // Load environment variables from .env file

const app = express();

AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});


const s3 = new AWS.S3();
const translate = new AWS.Translate();

const bucketName = process.env.S3_BUCKET_NAME
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
});

app.use(express.json()); // Middleware to parse JSON request body

/**
 * Extracts text from a file based on its type.
 * @param {string} filePath - The path to the file from which to extract text.
 * @param {string} fileType - The type of the file (e.g., 'pdf', 'docx', 'txt').
 * @returns {Promise<string>} - A promise that resolves to the extracted text.
 * @throws {Error} - Throws an error if the file cannot be parsed or contains no extractable text.
 */
async function extractText(filePath, fileType) {
    try {
        let text = '';

        if (fileType === 'pdf') {
            const dataBuffer = fs.readFileSync(filePath);
            const data = await pdfParse(dataBuffer);

            if (!data.text.trim()) {
                throw new Error("PDF contains no extractable text (scanned or encrypted).");
            }

            // Format extracted text to maintain structure
            text = data.text
                .replace(/-\s+/g, '')  // Fix words split by hyphens
                .replace(/(?<=\n)\s+/g, '') // Remove extra spaces at new lines
                .trim();
        } else if (fileType === 'docx') {
            const { value } = await mammoth.extractRawText({ path: filePath });

            // Ensure bullet points and formatting are retained
            text = value.replace(/•/g, '\n•').trim() || '';
        } else if(fileType === 'txt') {
            text = fs.readFileSync(filePath, 'utf-8');
        }
        return text;
    } catch (error) {
        console.error("Error parsing file:", error.message);
        throw new Error("Failed to extract text. Ensure the file is not encrypted or scanned.");
    }
}

app.post('/upload', upload.single('file'), async (req, res) => {
    // Check if a file was uploaded
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded or file size exceeds limit" });
    }
    
    // Destructure source and target languages from the request body
    const { sourceLang, targetLang } = req.body;
    // Validate that both sourceLang and targetLang are provided
    if (!sourceLang || !targetLang) {
        return res.status(400).json({ error: "Missing sourceLang or targetLang in request body" });
    }
    
    const filePath = req.file.path; // Get the path of the uploaded file
    const objectKey = req.file.originalname; // Get the original name of the uploaded file
    const fileExtension = path.extname(objectKey).toLowerCase(); // Extract the file extension
    let fileType; // Initialize variable to hold the file type
    
    // Determine the file type based on the file extension
    if (fileExtension === '.pdf') fileType = 'pdf';
    else if (fileExtension === '.docx') fileType = 'docx';
    else if (fileExtension === '.txt') fileType = 'txt';
    
    try {
        // Upload file to S3
        const fileContent = fs.readFileSync(filePath); // Read the file content
        await s3.upload({ Bucket: bucketName, Key: objectKey, Body: fileContent }).promise(); // Upload to S3
        console.log(`File uploaded to s3://${bucketName}/${objectKey}`);

        // Extract text from the uploaded file
        const textContent = await extractText(filePath, fileType); // Call the extractText function
        fs.unlinkSync(filePath); // Delete the local file after extraction

        // Prepare parameters for translation
        const translateParams = {
            Document: {
                Content: Buffer.from(textContent, 'utf8'), // Convert extracted text to Buffer
                ContentType: 'text/plain' // AWS Translate needs this format
            },
            SourceLanguageCode: sourceLang,
            TargetLanguageCode: targetLang
        };
        
        
        // Call AWS Translate to translate the document
        const translateResponse = await translate.translateDocument(translateParams).promise();
        // console.log("Translation job completed.", translateResponse); // Optional logging

        // Re-upload translated file to S3 (overwriting original file)
        await s3.upload({ 
            Bucket: bucketName, 
            Key: objectKey, 
            Body: translateResponse.TranslatedDocument.Content 
        }).promise();
        // console.log("Translated file uploaded back to S3");

        // Send success response to the client
        res.json({ message: "File uploaded, translated, and reuploaded successfully" });
    } catch (error) {
        console.error(error); // Log any errors that occur
        res.status(500).json({ error: "Error processing request" }); // Send error response
    }
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
