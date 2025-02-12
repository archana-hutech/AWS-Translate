const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth'); // For .docx files
const pdfParse = require('pdf-parse');
const { sortedUniq } = require('pdf-lib');
require('dotenv').config();

const app = express();
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
});

AWS.config.update({
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const s3 = new AWS.S3();
const translate = new AWS.Translate();

const downloadFileFromS3 = async (bucket, key, downloadPath) => {
    const params = {
        Bucket: bucket,
        Key: key,
    };
    const data = await s3.getObject(params).promise();
    fs.writeFileSync(downloadPath, data.Body);
};

const extractTextFromFile = async (filePath, fileType) => {
    let text = '';
    if (fileType === 'text/plain') {
        text = fs.readFileSync(filePath, 'utf-8');
    } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const result = await mammoth.extractRawText({ path: filePath });
        text = result.value.replace(/•/g, '\n•').trim() || '';
    } else if (fileType === 'application/pdf') {
        try {
            const dataBuffer = fs.readFileSync(filePath);
            const result = await pdfParse(dataBuffer);

            // Clean up the extracted text to maintain bullet points and line breaks
            text = result.text
                .replace(/-\s+/g, '')  // Fix words split by hyphens at line breaks
                .replace(/(?<=\n)\s+/g, '') // Remove unnecessary spaces at new lines
                .trim();
        } catch (error) {
            console.error('Error parsing PDF:', error);
            throw new Error('Failed to extract text from PDF.');
        }
    }
    return text.trim();
};

app.post('/upload-and-translate', upload.single('file'), async (req, res) => {
    const { targetLang, sourceLang } = req.body;
    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const fileType = req.file.mimetype;
    const bucketName = process.env.S3_BUCKET_NAME;

    if (!targetLang && !sourceLang) {
        return res.status(400).json({ error: 'Source and target language codes are required.' });
    }

    try {
        // Upload original file to S3
        const uploadParams = {
            Bucket: bucketName,
            Key: fileName,
            Body: fs.createReadStream(filePath),
            ContentType: fileType,
        };
        await s3.upload(uploadParams).promise();

        // Download file from S3 for processing
        const localDownloadPath = `uploads/${fileName}`;
        await downloadFileFromS3(bucketName, fileName, localDownloadPath);

        // Extract text from file
        const fileContent = await extractTextFromFile(localDownloadPath, fileType);
        if (!fileContent) {
            throw new Error('Failed to extract text from the file.');
        }

        // Translate text
        const translateParams = {
            Text: fileContent,
            SourceLanguageCode: sourceLang,
            TargetLanguageCode: targetLang,
        };
        const translationResult = await translate.translateText(translateParams).promise();
        const translatedText = translationResult.TranslatedText;

        // Re-upload translated text to the same S3 location
        const reuploadParams = {
            Bucket: bucketName,
            Key: fileName,
            Body: translatedText,
            ContentType: 'text/plain; charset=utf-8',
        };
        await s3.upload(reuploadParams).promise();

        fs.unlinkSync(filePath);
        fs.unlinkSync(localDownloadPath);

        const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

        res.status(200).json({ message: 'Translation successful!', fileUrl });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An error occurred during the process.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
