// const express = require('express');
// const AWS = require('aws-sdk');
// const multer = require('multer');
// const fs = require('fs');
// const mammoth = require('mammoth'); // For DOCX files
// const pdf = require('pdf-parse'); // For PDF files
// require('dotenv').config(); // Load environment variables from .env file

// // Configure AWS SDK
// AWS.config.update({
//     region: process.env.AWS_REGION, // Use region from .env
//     accessKeyId: process.env.AWS_ACCESS_KEY_ID, // Use access key from .env
//     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY // Use secret key from .env
// });

// const s3 = new AWS.S3();
// const translate = new AWS.Translate();
// const app = express();
// const upload = multer({ dest: 'uploads/' }); // Temporary storage for uploaded files

// // Function to extract text from different file types
// const extractTextFromFile = async (filePath, fileType) => {
//     let text = '';
//     if (fileType === 'application/pdf') {
//         const dataBuffer = fs.readFileSync(filePath);
//         const result = await pdf(dataBuffer);
//         text = result.text; // Extracted text from PDF
//     } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
//         const result = await mammoth.extractRawText({ path: filePath });
//         text = result.value; // Extracted text from DOCX
//     } else if (fileType === 'text/plain') {
//         text = fs.readFileSync(filePath, 'utf-8'); // Read plain text file
//     }
//     return text;
// };

// // Function to translate a document
// const translateDocument = async (content, contentType, sourceLanguage, targetLanguage) => {
//     const params = {
//         Document: {
//             Content: content, // Pass the content directly
//             ContentType: contentType, // Set the content type
//         },
//         SourceLanguageCode: sourceLanguage, // e.g., 'en' for English
//         TargetLanguageCode: targetLanguage, // e.g., 'hi' for Hindi
//     };

//     try {
//         const result = await translate.translateDocument(params).promise();
//         console.log('Translation Job:', result);
//         return result; // Contains information about the translation job
//     } catch (error) {
//         console.error('Error translating document:', error);
//         throw new Error(`Translation failed: ${error.message}`);
//     }
// }

// // Endpoint to upload and translate file
// app.post('/upload-and-translate', upload.single('file'), async (req, res) => {
//     const { targetLang } = req.body; // Get target language from request
//     const filePath = req.file.path;
//     const originalFileName = req.file.originalname;
//     const fileType = req.file.mimetype; // Get the MIME type of the uploaded file

//     // Validate that targetLang is provided
//     if (!targetLang) {
//         return res.status(400).json({ error: 'Target language code is required.' });
//     }

//     try {
//         // Upload the file to S3 with the correct Content-Type
//         const s3UploadParams = {
//             Bucket: 'hutech-translate', // Your S3 bucket name
//             Key: originalFileName, // Use the original file name
//             Body: fs.createReadStream(filePath), // Read the file from the local path
//             ContentType: fileType, // Set the content type based on the uploaded file
//         };
//         await s3.upload(s3UploadParams).promise();

//         // Extract text from the uploaded file
//         const fileContent = await extractTextFromFile(filePath, fileType);

//         // Create a temporary file to hold the translated text
//         const translatedFileName = `translated_${originalFileName}`;
//         const contentType = fileType; // Ensure this is set to a valid MIME type
//         const translatedText = await translateDocument(fileContent, contentType, 'en', targetLang);

//         // Re-upload the translated text to S3
//         const s3UploadTranslatedParams = {
//             Bucket: 'hutech-translate',
//             Key: translatedFileName, // Save the translated file with a new name
//             Body: translatedText, // The translated text
//             ContentType: 'text/plain; charset=utf-8', // Set to text/plain for the translated text
//         };
//         await s3.upload(s3UploadTranslatedParams).promise();

//         // Clean up the temporary file
//         fs.unlinkSync(filePath);

//         // Return the URL of the translated document
//         const translatedFileUrl = `https://${s3UploadTranslatedParams.Bucket}.s3.${AWS.config.region}.amazonaws.com/${translatedFileName}`;
//         res.status(200).json({ message: 'File uploaded and translated successfully!', translatedFileUrl });
//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ error: 'An error occurred during the process.' });
//     }
// });

// // Start the server
// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//     console.log(`Server is running on port ${PORT}`);
// });














const AWS = require('aws-sdk');
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const s3 = new AWS.S3();
const translate = new AWS.Translate();

const bucketName = "your-s3-bucket-name";
const upload = multer({ dest: 'uploads/' });

app.post('/upload', upload.single('file'), async (req, res) => {
    const filePath = req.file.path;
    const objectKey = req.file.originalname;
    
    try {
        // Upload file to S3
        const fileContent = fs.readFileSync(filePath);
        await s3.upload({ Bucket: bucketName, Key: objectKey, Body: fileContent }).promise();
        fs.unlinkSync(filePath);
        console.log(`File uploaded to s3://${bucketName}/${objectKey}`);

        // Translate document using TranslateDocument API format
        const translateParams = {
            Document: {
                Content: fileContent,
                ContentType: 'text/plain' // Change accordingly for different formats
            },
            SourceLanguageCode: 'en',
            TargetLanguageCode: 'fr',
            Settings: {
                Brevity: 'default',
                Formality: 'default',
                Profanity: 'masked'
            }
        };
        
        const translateResponse = await translate.translateDocument(translateParams).promise();
        console.log("Translation job completed.", translateResponse);

        // Re-upload translated file to S3 (overwriting original file)
        await s3.upload({ Bucket: bucketName, Key: objectKey, Body: translateResponse.TranslatedDocument.Content }).promise();
        console.log("Translated file uploaded back to S3");

        res.json({ message: "File uploaded, translated, and reuploaded successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error processing request" });
    }
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
