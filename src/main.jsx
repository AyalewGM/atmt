// import App from './App.jsx';

// const root = ReactDOM.createRoot(document.getElementById('root'));
// root.render(
//   React.createElement(React.StrictMode, null, React.createElement(App))
// );

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    signInAnonymously, 
    onAuthStateChanged,
    signInWithCustomToken
} from 'firebase/auth';
import { 
    getFirestore, 
    collection, 
    addDoc, 
    onSnapshot, 
    query, 
    doc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import { 
    getStorage, 
    ref, 
    uploadString, 
    getDownloadURL,
    deleteObject
} from 'firebase/storage';
import { 
    LayoutDashboard, FileText, BookOpen, Film, Book, GraduationCap, ImageIcon, Video, Sparkles, Loader2, 
    PlusCircle, Trash2, Save, X, Menu, BrainCircuit, ClipboardCopy, Share2, Lightbulb, MessageSquareQuote, 
    GitBranch, Send, CheckCircle, Users, Mic, Presentation, Mail, Scissors, Calendar as CalendarIcon, 
    ChevronLeft, ChevronRight, Music, Languages, Wand2, Archive, ArrowRight, Headphones, Download, Megaphone,
    Clipboard as ClipboardIcon, Check, Wind, MoreHorizontal, Target, Zap, Waves, BookCheck, RefreshCw,
    Search as SearchIcon, SortAsc, SortDesc, Play, Pause
} from 'lucide-react';
import { marked } from 'marked'; // Import marked for Markdown parsing
import DOMPurify from 'dompurify'; // Import DOMPurify for sanitization

// Import html2pdf library
const html2pdf = (typeof window !== 'undefined' && window.html2pdf) || null;

// --- BRAND & FIREBASE CONFIGURATION ---
const BRAND_INFO = {
    name: "Ancient Truths, Modern Times (ATMT)",
    usp: "The only blog focusing specifically on Ethiopian Orthodox Tewahedo theology with a modern, accessible format rooted in authentic tradition. Bridging ancient truths with modern times.",
    audience: "18–45 year old diaspora (U.S., Canada, UK, Ethiopia), students, young professionals, seekers. Spiritually curious, disillusioned with secular culture, seeking depth and authenticity.",
    tone: "Respectful, reverent, clear, compassionate, educational, authentic, and accessible (Grade 6-8 readability but theologically deep)."
};

// =================================================================================================
// IMPORTANT: Please insert your API key below.
// If the environment doesn't provides a key, you must manually replace "YOUR_API_KEY_HERE".
// =================================================================================================
const USER_API_KEY = "YOUR_API_KEY_HERE";
const API_KEY = USER_API_KEY !== "YOUR_API_KEY_HERE" ? USER_API_KEY : "";
// =================================================================================================

const firebaseConfig = typeof __firebase_config !== 'undefined' 
    ? JSON.parse(__firebase_config) 
    : { apiKey: "your-api-key", authDomain: "your-auth-domain", projectId: "your-project-id" };

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- API HELPER FUNCTIONS ---

/**
 * Calls the Gemini API with exponential backoff for text generation.
 * @param {string} prompt - The text prompt for the Gemini API.
 * @param {object} [responseSchema=null] - Optional JSON schema for structured responses.
 * @returns {Promise<string>} - The generated text.
 * @throws {Error} If the API call fails or returns an unexpected response.
*/
async function callGemini(prompt, responseSchema = null) {
    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            const payload = {
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.7,
                    topK: 1,
                    topP: 1,
                    maxOutputTokens: 8192,
                },
            };

            if (responseSchema) {
                payload.generationConfig.responseMimeType = "application/json";
                payload.generationConfig.responseSchema = responseSchema;
            }

            const apiKey = API_KEY;
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let errorBody;
                try {
                    errorBody = await response.json();
                } catch (e) {
                    errorBody = await response.text();
                }
                console.error("Gemini API Error Response:", {
                    status: response.status,
                    statusText: response.statusText,
                    body: errorBody
                });

                if (response.status === 429 || response.status >= 500) { // Too Many Requests or Server Errors
                    const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000; // Exponential backoff with jitter
                    console.warn(`Retrying Gemini API call (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    attempt++;
                    continue; // Retry the request
                } else {
                    const errorMessage = errorBody?.error?.message || `API request failed with status ${response.status}`;
                    throw new Error(errorMessage);
                }
            }

            const result = await response.json();

            if (!result.candidates || result.candidates.length === 0) {
                console.error("No candidates in API response:", JSON.stringify(result, null, 2));
                if (result.promptFeedback && result.promptFeedback.blockReason) {
                    throw new Error(`Content generation blocked. Reason: ${result.promptFeedback.blockReason}.`);
                }
                throw new Error("Error: API returned no candidates.");
            }
            
            const candidate = result.candidates[0];

            if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0 && candidate.content.parts[0].text) {
                let text = candidate.content.parts[0].text;
                if (candidate.finishReason === 'MAX_TOKENS') {
                    text += "\n\n[WARNING: The generated content was too long and has been cut short.]";
                }
                return text;
            } else {
                console.error("Unexpected API response structure or missing content:", JSON.stringify(result, null, 2));
                if (candidate.finishReason) {
                    throw new Error(`Content generation stopped unexpectedly. Reason: ${candidate.finishReason}.`);
                }
                throw new Error("Error: An unknown issue occurred with the API response.");
            }
        } catch (error) {
            // Re-throw if it's not a retryable error or max retries reached
            if (attempt === maxRetries || !(error.message.includes("Failed to fetch") || error.message.includes("NetworkError"))) {
                throw error;
            }
            const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000; // Exponential backoff with jitter
            console.warn(`Retrying Gemini API call (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms due to network error...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            attempt++;
        }
    }
    throw new Error("Max retries reached for Gemini API call.");
}

/**
 * Calls the Imagen API with exponential backoff for image generation.
 * @param {string} prompt - The text prompt for the Imagen API.
 * @param {string} [aspectRatio="1:1"] - The aspect ratio of the image (e.g., "1:1", "16:9").
 * @returns {Promise<string>} - Base64 encoded image data.
 * @throws {Error} If the API call fails or returns an unexpected response.
*/
async function callImagen(prompt, aspectRatio = "1:1") {
    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            const payload = { 
                instances: [{ prompt: `${prompt}` }], 
                parameters: { "sampleCount": 1, "aspectRatio": aspectRatio } 
            };
            const apiKey = API_KEY;
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let errorBody;
                try {
                    errorBody = await response.json();
                } catch (e) {
                    errorBody = await response.text();
                }
                console.error("Imagen API Error Response:", {
                    status: response.status,
                    statusText: response.statusText,
                    body: errorBody
                });

                if (response.status === 429 || response.status >= 500) { // Too Many Requests or Server Errors
                    const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000; // Exponential backoff with jitter
                    console.warn(`Retrying Imagen API call (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    attempt++;
                    continue; // Retry the request
                } else {
                    const errorMessage = errorBody?.error?.message || `Image Generation API call failed with status ${response.status}`;
                    throw new Error(errorMessage);
                }
            }

            const result = await response.json();
            if (result.predictions?.[0]?.bytesBase64Encoded) {
                return result.predictions[0].bytesBase64Encoded;
            } else {
                console.error("Unexpected API response:", result);
                throw new Error("Unexpected response from Imagen API or content filter triggered.");
            }
        } catch (error) {
            // Re-throw if it's not a retryable error or max retries reached
            if (attempt === maxRetries || !(error.message.includes("Failed to fetch") || error.message.includes("NetworkError"))) {
                throw error;
            }
            const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000; // Exponential backoff with jitter
            console.warn(`Retrying Imagen API call (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms due to network error...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            attempt++;
        }
    }
    throw new Error("Max retries reached for Imagen API call.");
}

/**
 * Calls the Gemini TTS API to convert text to a playable audio URL.
 * @param {string} text - The text to be converted to speech.
 * @param {string} [voiceName="Kore"] - The name of the voice to use.
 * @returns {Promise<string>} - A blob URL for the generated audio.
*/
async function callGeminiTTS(text, voiceName = "Kore") {
    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            const payload = {
                contents: [{ parts: [{ text: text }] }],
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: voiceName }
                        }
                    }
                },
                model: "gemini-2.5-flash-preview-tts"
            };
            const apiKey = API_KEY;
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                if (response.status === 429 || response.status >= 500) {
                    const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                    console.warn(`Retrying TTS API call (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    attempt++;
                    continue;
                }
                throw new Error(`TTS API failed with status: ${response.status}`);
            }

            const result = await response.json();
            const part = result?.candidates?.[0]?.content?.parts?.[0];
            const audioData = part?.inlineData?.data;
            const mimeType = part?.inlineData?.mimeType;

            if (audioData && mimeType && mimeType.startsWith("audio/")) {
                const sampleRate = parseInt(mimeType.match(/rate=(\d+)/)[1], 10);
                const pcmData = base64ToArrayBuffer(audioData);
                const pcm16 = new Int16Array(pcmData);
                const wavBlob = pcmToWav(pcm16, sampleRate);
                return URL.createObjectURL(wavBlob);
            } else {
                throw new Error("Invalid audio data from TTS API.");
            }
        } catch (error) {
            if (attempt === maxRetries || !(error.message.includes("Failed to fetch") || error.message.includes("NetworkError"))) {
                throw error;
            }
            const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
            console.warn(`Retrying TTS API call (attempt ${attempt + 1}/${maxRetries}) due to network error...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            attempt++;
        }
    }
    throw new Error("Max retries reached for TTS API call.");
}


// Helper for TTS
function pcmToWav(pcmData, sampleRate) {
    const buffer = new ArrayBuffer(44 + pcmData.length * 2);
    const view = new DataView(buffer);
    let offset = 0;

    function writeString(str) {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset++, str.charCodeAt(i));
        }
    }

    function writeUint32(val) {
        view.setUint32(offset, val, true);
        offset += 4;
    }

    function writeUint16(val) {
        view.setUint16(offset, val, true);
        offset += 2;
    }

    writeString('RIFF');
    writeUint32(36 + pcmData.length * 2);
    writeString('WAVE');
    writeString('fmt ');
    writeUint32(16);
    writeUint16(1);
    writeUint16(1); // Mono
    writeUint32(sampleRate);
    writeUint32(sampleRate * 2);
    writeUint16(2);
    writeUint16(16);
    writeString('data');
    writeUint32(pcmData.length * 2);
    
    for (let i = 0; i < pcmData.length; i++) {
        view.setInt16(offset, pcmData[i], true);
        offset += 2;
    }

    return new Blob([view], { type: 'audio/wav' });
}

function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Calls the Gemini API for image understanding.
 * @param {string} prompt - The text prompt for the Gemini API.
 * @param {string} base64ImageData - Base64 encoded image data.
 * @param {string} mimeType - The MIME type of the image (e.g., "image/jpeg", "image/png").
 * @returns {Promise<string>} - The generated text analysis.
 * @throws {Error} If the API call fails or returns an unexpected response.
 */
async function callGeminiVision(prompt, base64ImageData, mimeType) {
    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            const payload = {
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: mimeType,
                                    data: base64ImageData
                                }
                            }
                        ]
                    }
                ],
                generationConfig: {
                    temperature: 0.4,
                    topK: 32,
                    topP: 1,
                    maxOutputTokens: 4096,
                },
            };
            const apiKey = API_KEY;
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let errorBody;
                try {
                    errorBody = await response.json();
                } catch (e) {
                    errorBody = await response.text();
                }
                console.error("Gemini Vision API Error Response:", {
                    status: response.status,
                    statusText: response.statusText,
                    body: errorBody
                });

                if (response.status === 429 || response.status >= 500) { // Too Many Requests or Server Errors
                    const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000; // Exponential backoff with jitter
                    console.warn(`Retrying Gemini Vision API call (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    attempt++;
                    continue; // Retry the request
                } else {
                    const errorMessage = errorBody?.error?.message || `Vision API request failed with status ${response.status}`;
                    throw new Error(errorMessage);
                }
            }

            const result = await response.json();
            if (result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts.length > 0) {
                return result.candidates[0].content.parts[0].text;
            } else {
                console.error("Unexpected Vision API response structure or missing content:", JSON.stringify(result, null, 2));
                throw new Error("Error: An unknown issue occurred with the Vision API response.");
            }
        } catch (error) {
            if (attempt === maxRetries || !(error.message.includes("Failed to fetch") || error.message.includes("NetworkError"))) {
                throw error;
            }
            const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000; // Exponential backoff with jitter
            console.warn(`Retrying Gemini Vision API call (attempt ${attempt + 1}/${maxRetries}) due to network error...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            attempt++;
        }
    }
    throw new Error("Max retries reached for Gemini Vision API call.");
}


/**
 * Calls the Gemini API to get book recommendations.
 * @param {string} topicOrContent - The topic or content to base recommendations on.
 * @returns {Promise<Array<{title: string, author: string}>>} - An array of recommended books.
 */
async function getRecommendedBooks(topicOrContent) {
    const prompt = `You are a librarian and theologian for "Ancient Truths, Modern Times". Based on the following topic or content, recommend 3-5 highly relevant and authoritative books (titles and authors) from an Ethiopian Orthodox Tewahedo or broader Patristic perspective for further reading. If no specific books come to mind, suggest relevant themes or areas of study. Return a JSON object with a 'books' array, where each item has 'title' and 'author' (or 'theme' if no specific book).
    
    Topic/Content:
    ${topicOrContent.substring(0, 3000)}
    `;
    const schema = {
        type: "OBJECT",
        properties: {
            books: {
                type: "ARRAY",
                items: {
                    type: "OBJECT",
                    properties: {
                        title: { type: "STRING" },
                        author: { type: "STRING" }
                    },
                    required: ["title", "author"]
                }
            }
        },
        required: ["books"]
    };

    try {
        const resultText = await callGemini(prompt, schema);
        const parsedResult = JSON.parse(resultText);
        return parsedResult.books || [];
    } catch (error) {
        console.error("Failed to get book recommendations:", error);
        return [];
    }
}


// --- MAIN APP COMPONENT ---
export default function App() {
    const [view, setView] = useState('dashboard');
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [auth, setAuth] = useState(null);
    const [db, setDb] = useState(null);
    const [storage, setStorage] = useState(null);
    const [userId, setUserId] = useState(null);
    const [projects, setProjects] = useState([]);
    const [scheduledPosts, setScheduledPosts] = useState([]);
    const [activeProject, setActiveProject] = useState(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [modal, setModal] = useState({ isOpen: false, content: null });

    // --- Firebase Initialization and Auth ---
    useEffect(() => {
        const app = initializeApp(firebaseConfig);
        const authInstance = getAuth(app);
        const dbInstance = getFirestore(app);
        const storageInstance = getStorage(app);
        
        setAuth(authInstance);
        setDb(dbInstance);
        setStorage(storageInstance);

        const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
            if (user) {
                setUserId(user.uid);
            } else {
                try {
                    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                        await signInWithCustomToken(authInstance, __initial_auth_token);
                    } else {
                        await signInAnonymously(authInstance);
                    }
                } catch (error) {
                    console.error("Authentication Error:", error);
                }
            }
            setIsAuthReady(true);
        });

        return () => unsubscribe();
    }, []);

    // --- Data Fetching from Firestore ---
    useEffect(() => {
        if (!isAuthReady || !db || !userId) return;

        const projectsCollectionPath = `artifacts/${appId}/users/${userId}/projects`;
        const projectsQuery = query(collection(db, projectsCollectionPath));
        const unsubscribeProjects = onSnapshot(projectsQuery, (snapshot) => {
            const projectsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            projectsData.sort((a, b) => (b.updatedAt?.toMillis() || 0) - (a.updatedAt?.toMillis() || 0));
            setProjects(projectsData);
        }, (error) => console.error("Error fetching projects:", error));
        
        const scheduledPostsCollectionPath = `artifacts/${appId}/users/${userId}/scheduledPosts`;
        const scheduledPostsQuery = query(collection(db, scheduledPostsCollectionPath));
        const unsubscribeScheduledPosts = onSnapshot(scheduledPostsQuery, (snapshot) => {
            const postsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setScheduledPosts(postsData);
        }, (error) => console.error("Error fetching scheduled posts:", error));


        return () => {
            unsubscribeProjects();
            unsubscribeScheduledPosts();
        };
    }, [isAuthReady, db, userId]);
    
    // --- Event Handlers ---
    const handleCreateNewProject = async (type, title = `Untitled ${type}`, content = '') => {
        if (!db || !userId) return;
        const newProject = {
            title,
            content,
            type,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };
        try {
            const collectionPath = `artifacts/${appId}/users/${userId}/projects`;
            const docRef = await addDoc(collection(db, collectionPath), newProject);
            const createdProject = { id: docRef.id, ...newProject, createdAt: new Date(), updatedAt: new Date() }; // Simulate timestamp for immediate use
            setActiveProject(createdProject);
            setView('editor');
            return createdProject;
        } catch (error) {
            console.error("Error creating new project:", error);
            setModal({ isOpen: true, content: <AlertModal title="Error" message={`Failed to create new project: ${error.message}`} onClose={() => setModal({ isOpen: false, content: null })} /> });
        }
    };
    
    const handleSelectProject = (project) => {
        setActiveProject(project);
        setView('editor');
    };

    const handleSaveProject = async (projectToSave) => {
        if (!db || !projectToSave?.id) return;
        try {
            const docRef = doc(db, `artifacts/${appId}/users/${userId}/projects`, projectToSave.id);
            await updateDoc(docRef, { ...projectToSave, updatedAt: serverTimestamp() });
        } catch (error) {
            console.error("Error saving project:", error);
        }
    };
    
    const handleDeleteProject = async (projectId) => {
        setModal({
            isOpen: true,
            content: (
                <ConfirmationModal
                    title="Confirm Deletion"
                    message="Are you sure you want to delete this project? This action cannot be undone."
                    onConfirm={async () => {
                        if (!db || !projectId) return;
                        try {
                            const docRef = doc(db, `artifacts/${appId}/users/${userId}/projects`, projectId);
                            await deleteDoc(docRef);
                            if (activeProject?.id === projectId) {
                                setActiveProject(null);
                                setView('dashboard');
                            }
                        } catch (error) {
                            console.error("Error deleting project:", error);
                            setModal({ isOpen: true, content: <AlertModal title="Error" message={`Failed to delete project: ${error.message}`} onClose={() => setModal({ isOpen: false, content: null })} /> });
                        } finally {
                            setModal({ isOpen: false, content: null });
                        }
                    }}
                    onCancel={() => setModal({ isOpen: false, content: null })}
                />
            )
        });
    };

    const navigateTo = (newView) => {
        setView(newView);
        setActiveProject(null);
        if(window.innerWidth < 768) setIsSidebarOpen(false);
    };

    const renderView = () => {
        if (!isAuthReady) return <LoadingSpinner message="Authenticating..." />;
        switch (view) {
            case 'dashboard':
                return <DashboardView projects={projects} onCreateNew={handleCreateNewProject} onSelectProject={handleSelectProject} setModal={setModal} navigateTo={navigateTo} />;
            case 'studio':
                return <StudioView onCreateProject={handleCreateNewProject} setModal={setModal} />;
            case 'blog':
            case 'sermon':
            case 'podcast':
            case 'series':
            case 'devotional':
            case 'ebooks':
            case 'courses':
            case 'videos':
            case 'lyrics':
                const filteredProjects = projects.filter(p => p.type === view);
                return <ProjectListView projects={filteredProjects} type={view} onCreateNew={handleCreateNewProject} onSelectProject={handleSelectProject} setModal={setModal} />;
            case 'editor':
                return <EditorView project={activeProject} onSave={handleSaveProject} onDelete={handleDeleteProject} setProject={setActiveProject} setModal={setModal} onCreateProject={handleCreateNewProject} db={db} userId={userId} storage={storage} />;
            case 'scheduler':
                return <SchedulerView scheduledPosts={scheduledPosts} projects={projects} setModal={setModal} db={db} userId={userId} handleCreateNewProject={handleCreateNewProject} />;
            default:
                return <ComingSoonView featureName={view.charAt(0).toUpperCase() + view.slice(1)} />;
        }
    };

    return (
        <div className="flex h-screen bg-[#003366] text-white font-sans">
            <Sidebar navigateTo={navigateTo} currentView={view} isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen} setModal={setModal} handleCreateNewProject={handleCreateNewProject} />
            <main className="flex-1 flex flex-col overflow-hidden">
                <header className="md:hidden flex items-center justify-between p-4 bg-[#003366]/80 backdrop-blur-sm border-b border-[#D4AF37]/20">
                    <div className="flex items-center gap-2">
                        <BrainCircuit className="text-[#D4AF37]" />
                        <h1 className="text-lg font-bold">ATMT Hub</h1>
                    </div>
                    <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 rounded-md hover:bg-[#800020]/50">
                        {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
                    </button>
                </header>
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
                    {renderView()}
                </div>
            </main>
            {modal.isOpen && modal.content}
        </div>
    );
}

// --- Sidebar Component ---
const Sidebar = ({ navigateTo, currentView, isSidebarOpen, setIsSidebarOpen, setModal, handleCreateNewProject }) => {
    const navItems = useMemo(() => [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'studio', label: '✨ Content Studio', icon: Wand2 },
        { id: 'scheduler', label: '✨ Scheduler', icon: CalendarIcon },
        { id: 'ask-the-fathers', label: '✨ Ask the Fathers', icon: MessageSquareQuote, isModal: true },
        { id: 'visual-insights', label: '✨ Visual Insights', icon: ImageIcon, isModal: true }, // New item
    ], []);

    const contentTypes = useMemo(() => [
        { id: 'blog', label: 'Blog Posts', icon: FileText },
        { id: 'sermon', label: 'Sermons', icon: BookOpen },
        { id: 'podcast', label: 'Podcasts', icon: Mic },
        { id: 'series', label: 'Series', icon: Film },
        { id: 'devotional', label: 'Devotionals', icon: Mail },
        { id: 'ebooks', label: 'E-books', icon: Book },
        { id: 'courses', label: 'Courses', icon: GraduationCap },
        { id: 'videos', label: 'Videos', icon: Video },
        { id: 'lyrics', label: 'Lyrics', icon: Music },
    ], []);

    const NavLink = ({ id, label, icon: Icon, isModal }) => (
        <button
            onClick={() => {
                if(isModal) {
                    // Handle specific modals here
                    if (id === 'ask-the-fathers') {
                        setModal({ isOpen: true, content: <AskTheFathersModal onClose={() => setModal({isOpen: false, content: null})} setModal={setModal} handleCreateNewProject={handleCreateNewProject} /> });
                    } else if (id === 'visual-insights') {
                        setModal({ isOpen: true, content: <VisualInsightsModal onClose={() => setModal({isOpen: false, content: null})} setModal={setModal} handleCreateNewProject={handleCreateNewProject} /> });
                    }
                } else {
                    navigateTo(id)
                }
            }}
            className={`flex items-center w-full px-4 py-3 text-sm font-medium rounded-lg transition-colors duration-200 ${
                currentView === id ? 'bg-[#800020] text-white' : 'text-gray-300 hover:bg-[#800020]/50 hover:text-white'
            }`}
        >
            <Icon size={20} className="mr-4 flex-shrink-0" />
            <span>{label}</span>
        </button>
    );

    return (
        <>
            <aside className={`absolute md:relative z-30 flex-shrink-0 w-64 bg-[#002244]/50 backdrop-blur-lg border-r border-[#D4AF37]/20 flex flex-col transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
                <div className="flex items-center justify-center h-20 border-b border-[#D4AF37]/20">
                    <div className="flex items-center gap-3">
                        <BrainCircuit className="text-[#D4AF37] h-8 w-8" />
                        <h1 className="text-xl font-bold text-white">ATMT Creator Hub</h1>
                    </div>
                </div>
                <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
                    <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Tools</p>
                    {navItems.map(item => <NavLink key={item.id} {...item} />)}
                    <p className="px-4 pt-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Content Types</p>
                    {contentTypes.map(item => <NavLink key={item.id} {...item} />)}
                </nav>
                <div className="p-4 border-t border-[#D4AF37]/20 text-xs text-gray-500">
                    <p>Powered by Gemini</p>
                    <p>&copy; {new Date().getFullYear()} Ancient Truths, Modern Times</p>
                </div>
            </aside>
            {isSidebarOpen && <div onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 bg-black/60 z-20 md:hidden"></div>}
        </>
    );
};

// --- View Components ---

const DashboardView = ({ projects, onCreateNew, onSelectProject, setModal, navigateTo }) => {
    return (
        <div className="animate-fade-in">
            <h1 className="text-3xl font-bold text-white mb-2">Dashboard</h1>
            <p className="text-gray-300 mb-8">Welcome back! Let's create something powerful today.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <ActionCard title="✨ Content Studio" icon={Wand2} onClick={() => navigateTo('studio')} isFeatured={true} description="Brainstorm & generate new content." />
                <ActionCard title="✨ Patristic Exegesis" icon={BookOpen} onClick={() => setModal({ isOpen: true, content: <PatristicExegesisModal setModal={setModal} onClose={() => setModal({ isOpen: false, content: null })} onCreateProject={onCreateNew} /> })} isFeatured={true} description="AI-powered Bible study." />
                <ActionCard title="✨ Ask the Fathers" icon={MessageSquareQuote} onClick={() => setModal({ isOpen: true, content: <AskTheFathersModal onClose={() => setModal({isOpen: false, content: null})} setModal={setModal} handleCreateNewProject={onCreateNew} /> })} isFeatured={true} description="Consult the Patristic Guide." />
                <ActionCard title="✨ Scheduler" icon={CalendarIcon} onClick={() => navigateTo('scheduler')} isFeatured={true} description="Plan your content calendar." />
            </div>

            <div className="mb-8">
                <h2 className="text-2xl font-semibold text-white mb-4">Recent Work</h2>
                {projects.length > 0 ? (
                    <div className="bg-[#002244]/50 rounded-lg border border-[#D4AF37]/20">
                        <ul className="divide-y divide-[#D4AF37]/20">
                            {projects.slice(0, 5).map(project => (
                                <li key={project.id} onClick={() => onSelectProject(project)} className="p-4 flex justify-between items-center hover:bg-[#800020]/30 cursor-pointer transition-colors">
                                    <div>
                                        <p className="font-semibold text-[#D4AF37]">{project.title}</p>
                                        <p className="text-sm text-gray-400">
                                            {project.type.charAt(0).toUpperCase() + project.type.slice(1)} - Updated {project.updatedAt ? new Date(project.updatedAt.toDate()).toLocaleString() : 'recently'}
                                        </p>
                                    </div>
                                    <ChevronRight size={20} className="text-gray-500" />
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : (
                    <div className="text-center py-12 bg-[#002244]/50 rounded-lg border border-[#D4AF37]/20 border-dashed">
                        <p className="text-gray-400">No recent projects. Ready to start your first one?</p>
                    </div>
                )}
            </div>

            <div>
                <h2 className="text-2xl font-semibold text-white mb-4">Content Gallery</h2>
                    {projects.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {projects.map(project => (
                                <ContentCard key={project.id} project={project} onSelect={onSelectProject} />
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-12 bg-[#002244]/50 rounded-lg border border-[#D4AF37]/20 border-dashed">
                            <p className="text-gray-400">Your saved content will appear here.</p>
                        </div>
                    )}
            </div>
        </div>
    );
};

const ContentCard = ({ project, onSelect }) => {
    const getIcon = (type) => {
        switch(type) {
            case 'blog': return <FileText className="h-6 w-6 text-[#D4AF37]" />;
            case 'sermon': return <BookOpen className="h-6 w-6 text-[#D4AF37]" />;
            case 'podcast': return <Mic className="h-6 w-6 text-[#D4AF37]" />;
            case 'series': return <Film className="h-6 w-6 text-[#D4AF37]" />;
            case 'devotional': return <Mail className="h-6 w-6 text-[#D4AF37]" />;
            case 'ebooks': return <Book className="h-6 w-6 text-[#D4AF37]" />;
            case 'courses': return <GraduationCap className="h-6 w-6 text-[#D4AF37]" />;
            case 'videos': return <Video className="h-6 w-6 text-[#D4AF37]" />;
            case 'lyrics': return <Music className="h-6 w-6 text-[#D4AF37]" />;
            default: return <FileText className="h-6 w-6 text-[#D4AF37]" />;
        }
    };

    return (
        <div onClick={() => onSelect(project)} className="bg-[#002244]/50 p-4 rounded-lg border border-[#D4AF37]/20 hover:border-[#D4AF37] cursor-pointer transition-all flex flex-col justify-between h-40">
            <div>
                <div className="flex items-center gap-3 mb-2">
                    {getIcon(project.type)}
                    <h3 className="font-semibold text-white truncate">{project.title}</h3>
                </div>
                <p className="text-sm text-gray-400 line-clamp-3">{project.content || "No content yet."}</p>
            </div>
            <p className="text-xs text-gray-500 mt-2 self-end">
                {project.type.charAt(0).toUpperCase() + project.type.slice(1)}
            </p>
        </div>
    );
};

const ProjectListView = ({ projects, type, onCreateNew, onSelectProject, setModal }) => {
    const typeName = type.charAt(0).toUpperCase() + type.slice(1);
    const pluralTypeName = {
        'blog': 'Blog Posts', 'sermon': 'Sermons', 'podcast': 'Podcasts', 'series': 'Series',
        'devotional': 'Devotionals', 'ebooks': 'E-books', 'courses': 'Courses', 'videos': 'Videos',
        'lyrics': 'Lyrics'
    }[type] || typeName + 's';

    const [searchTerm, setSearchTerm] = useState('');
    const [sortKey, setSortKey] = useState('updatedAt'); // 'updatedAt' or 'title'
    const [sortDirection, setSortDirection] = useState('desc'); // 'asc' or 'desc'

    const filteredAndSortedProjects = useMemo(() => {
        let filtered = projects.filter(project => {
            const matchesSearch = searchTerm.toLowerCase() === '' ||
                project.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                project.content.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesSearch;
        });

        filtered.sort((a, b) => {
            if (sortKey === 'updatedAt') {
                const dateA = a.updatedAt?.toMillis() || 0;
                const dateB = b.updatedAt?.toMillis() || 0;
                return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
            } else if (sortKey === 'title') {
                const titleA = a.title.toLowerCase();
                const titleB = b.title.toLowerCase();
                if (titleA < titleB) return sortDirection === 'asc' ? -1 : 1;
                if (titleA > titleB) return sortDirection === 'asc' ? 1 : -1;
                return 0;
            }
            return 0;
        });
        return filtered;
    }, [projects, searchTerm, sortKey, sortDirection]);

    const handleClearFilters = () => {
        setSearchTerm('');
        setSortKey('updatedAt');
        setSortDirection('desc');
    };

    const openBrainstormModal = () => {
        let modalContent;
        if (type === 'blog') {
            modalContent = <IdeaGeneratorModal onClose={() => setModal({ isOpen: false, content: null })} onCreateProject={onCreateNew} setModal={setModal} />;
        } else if (type === 'sermon') {
            modalContent = <SermonIdeaGeneratorModal onClose={() => setModal({ isOpen: false, content: null })} onCreateProject={onCreateNew} setModal={setModal} />;
        } else if (type === 'series') {
            modalContent = <SeriesIdeaGeneratorModal onClose={() => setModal({ isOpen: false, content: null })} onCreateProject={onCreateNew} setModal={setModal} />;
        } else if (type === 'devotional') {
            modalContent = <DevotionalIdeaGeneratorModal onClose={() => setModal({ isOpen: false, content: null })} onCreateProject={onCreateNew} setModal={setModal} />;
        } else if (type === 'ebooks') {
            modalContent = <EbookIdeaGeneratorModal onClose={() => setModal({ isOpen: false, content: null })} onCreateProject={onCreateNew} setModal={setModal} />;
        } else if (type === 'courses') {
            modalContent = <CourseIdeaGeneratorModal onClose={() => setModal({ isOpen: false, content: null })} onCreateProject={onCreateNew} setModal={setModal} />;
        } else if (type === 'videos') {
            modalContent = <VideoIdeaGeneratorModal onClose={() => setModal({ isOpen: false, content: null })} onCreateProject={onCreateNew} setModal={setModal} />;
        }
        setModal({ isOpen: true, content: modalContent });
    };

    return (
        <div className="animate-fade-in">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-3xl font-bold text-white">Your {pluralTypeName}</h1>
                <div className="flex items-center gap-2">
                    {['blog', 'sermon', 'series', 'devotional', 'ebooks', 'courses', 'videos'].includes(type) && (
                        <button 
                            onClick={openBrainstormModal}
                            className="px-4 py-2 font-semibold text-white bg-[#D4AF37]/80 rounded-lg hover:bg-[#D4AF37] flex items-center gap-2"
                        >
                            <Lightbulb size={20} />
                            <span>Brainstorm {typeName}</span>
                        </button>
                    )}
                    <button 
                        onClick={() => onCreateNew(type)}
                        className="px-4 py-2 font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 flex items-center gap-2"
                    >
                        <PlusCircle size={20} />
                        <span>New {typeName}</span>
                    </button>
                </div>
            </div>

            {/* Search and Filter Controls */}
            <div className="bg-[#002244]/50 rounded-lg border border-[#D4AF37]/20 p-4 mb-6 flex flex-col sm:flex-row items-center gap-4">
                <div className="relative w-full sm:w-1/2">
                    <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                        type="text"
                        placeholder={`Search ${pluralTypeName}...`}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-[#003366] border border-[#D4AF37]/30 rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:outline-none text-white"
                    />
                </div>
                <div className="flex items-center gap-2 w-full sm:w-1/2 justify-end">
                    <label htmlFor="sort-by" className="text-sm font-medium text-gray-300">Sort by:</label>
                    <select
                        id="sort-by"
                        value={sortKey}
                        onChange={(e) => setSortKey(e.target.value)}
                        className="bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                    >
                        <option value="updatedAt">Last Modified</option>
                        <option value="title">Title</option>
                    </select>
                    <button
                        onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                        className="p-2 rounded-lg bg-[#003366] border border-[#D4AF37]/30 text-gray-300 hover:bg-[#003366]/80"
                        title={sortDirection === 'asc' ? 'Sort Descending' : 'Sort Ascending'}
                    >
                        {sortDirection === 'asc' ? <SortAsc size={18} /> : <SortDesc size={18} />}
                    </button>
                    {(searchTerm !== '' || sortKey !== 'updatedAt' || sortDirection !== 'desc') && (
                        <button onClick={handleClearFilters} className="px-3 py-2 text-sm font-semibold text-gray-300 bg-gray-700 rounded-lg hover:bg-gray-600">
                            Clear Filters
                        </button>
                    )}
                </div>
            </div>

            {filteredAndSortedProjects.length > 0 ? (
                <div className="bg-[#002244]/50 rounded-lg border border-[#D4AF37]/20">
                    <ul className="divide-y divide-[#D4AF37]/20">
                        {filteredAndSortedProjects.map(project => (
                            <li key={project.id} onClick={() => onSelectProject(project)} className="p-4 flex justify-between items-center hover:bg-[#800020]/30 cursor-pointer transition-colors">
                                <div>
                                    <p className="font-semibold text-[#D4AF37]">{project.title}</p>
                                    <p className="text-sm text-gray-400">
                                        Updated {project.updatedAt ? new Date(project.updatedAt.toDate()).toLocaleString() : 'recently'}
                                    </p>
                                </div>
                                <ChevronRight size={20} className="text-gray-500" />
                            </li>
                        ))}
                    </ul>
                </div>
            ) : (
                <div className="text-center py-20 bg-[#002244]/50 rounded-lg border border-[#D4AF37]/20 border-dashed">
                    <h3 className="text-xl font-semibold text-white">No {pluralTypeName} Found</h3>
                    <p className="text-gray-400 mt-2 mb-4">Adjust your search or filters, or create a new {typeName.toLowerCase()}.</p>
                </div>
            )}
        </div>
    );
};

const ActionCard = ({ title, icon: Icon, onClick, isFeatured = false, description }) => (
    <button onClick={onClick} className={`p-6 bg-[#002244]/50 rounded-lg border hover:bg-[#002244] transition-all group text-left h-full flex flex-col ${isFeatured ? 'border-[#D4AF37]/60' : 'border-[#D4AF37]/20 hover:border-[#D4AF37]/60'}`}>
        <Icon className={`h-8 w-8 mb-4 transition-transform group-hover:-translate-y-1 ${isFeatured ? 'text-[#D4AF37]' : 'text-gray-400 group-hover:text-[#D4AF37]'}`} />
        <h3 className="font-semibold text-lg text-white">{title}</h3>
        <p className="text-sm text-gray-400 mt-1 flex-grow">{description}</p>
    </button>
);

// --- STUDIO VIEW (NEWLY INTEGRATED) ---

const StudioView = ({ onCreateProject, setModal }) => {
    const [activeTab, setActiveTab] = useState('generator');

    const tabs = [
        { id: 'generator', label: 'Content Generator', icon: Wand2, component: <StudioContentGenerator onCreateProject={onCreateProject} setModal={setModal}/> },
        { id: 'lyrics', label: 'Lyrics & Sound', icon: Music, component: <StudioChantLyricist onCreateProject={onCreateProject} setModal={setModal}/> },
    ];

    const ActiveComponent = tabs.find(tab => tab.id === activeTab)?.component;

    return (
        <div className="animate-fade-in">
             <header className="text-left mb-8">
                <h1 className="text-3xl font-bold text-white flex items-center gap-3"><Wand2 className="text-[#D4AF37]"/>Content Studio</h1>
                <p className="text-gray-300 mt-2">AI-powered tools to brainstorm and generate first drafts of your content.</p>
            </header>

            <div className="bg-[#002244]/30 border border-[#D4AF37]/20 rounded-xl shadow-xl">
                <div className="p-2 sm:p-4 border-b border-[#D4AF37]/20">
                    <nav className="flex items-center space-x-1 sm:space-x-2">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center space-x-2 px-3 py-2 text-sm sm:text-base font-medium rounded-lg transition-colors duration-200 ${
                                    activeTab === tab.id
                                        ? 'bg-[#800020]/80 text-white'
                                        : 'text-gray-300 hover:bg-[#800020]/50 hover:text-white'
                                }`}
                            >
                                <tab.icon className="h-5 w-5" />
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </nav>
                </div>
                <main className="p-4 md:p-6">
                    {ActiveComponent}
                </main>
            </div>
        </div>
    );
};

const StudioContentGenerator = ({ onCreateProject, setModal }) => {
    const [step, setStep] = useState('brainstorm'); // brainstorm, select, develop
    const [topic, setTopic] = useState('');
    const [ideas, setIdeas] = useState([]);
    const [selectedIdea, setSelectedIdea] = useState(null);
    const [generatedContent, setGeneratedContent] = useState('');
    const [contentType, setContentType] = useState('');
    const [loading, setLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [recommendedBooks, setRecommendedBooks] = useState([]); // New state for books
    const [isLoadingBooks, setIsLoadingBooks] = useState(false); // New state for loading books

    const handleStartOver = () => {
        setStep('brainstorm');
        setTopic('');
        setIdeas([]);
        setSelectedIdea(null);
        setGeneratedContent('');
        setRecommendedBooks([]);
        setIsLoadingBooks(false);
    };

    const generateIdeas = async () => {
        if (!topic) return;
        setLoading(true);
        setIdeas([]);
        setGeneratedContent('');
        setSelectedIdea(null);
        setRecommendedBooks([]);
        setIsLoadingBooks(false);

        const prompt = `You are a content strategist for "${BRAND_INFO.name}". Brand USP: ${BRAND_INFO.usp}. Target Audience: ${BRAND_INFO.audience}. Tone: ${BRAND_INFO.tone}. My keyword/theme is: "${topic}". Brainstorm 5 engaging content ideas based on this theme.`;
        const schema = { type: "OBJECT", properties: { ideas: { type: "ARRAY", items: { type: "OBJECT", properties: { title: { type: "STRING" }, description: { type: "STRING" } }, required: ["title", "description"] } } }, required: ["ideas"] };

        try {
            const resultText = await callGemini(prompt, schema);
            const resultJson = JSON.parse(resultText);
            if (resultJson.ideas) {
                setIdeas(resultJson.ideas);
                setStep('select');
            } else {
                setModal({ isOpen: true, content: <AlertModal title="AI Error" message="The AI returned an unexpected format. Please try again." onClose={() => setModal({ isOpen: false, content: null })} /> });
            }
        } catch (e) {
            console.error("Failed to parse JSON response:", e);
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Could not understand the AI's response: ${e.message}`} onClose={() => setModal({ isOpen: false, content: null })} /> });
        }
        setLoading(false);
    };

    const handleSelectIdea = (idea) => {
        setSelectedIdea(idea);
        setStep('develop');
    };

    const developContent = async (type) => {
        if (!selectedIdea) return;
        setLoading(true);
        setGeneratedContent('');
        setRecommendedBooks([]);
        setIsLoadingBooks(false);
        setContentType(type);

        let prompt;
        if (type === 'podcast') {
            prompt = `You are a scriptwriter for the podcast "${BRAND_INFO.name}". Tone: ${BRAND_INFO.tone}. Podcast Topic: "${selectedIdea.title}". Brief: "${selectedIdea.description}". Write a detailed, deep-dive podcast script (approx. 800-1000 words) for a solo narrator. The script must be educational, reverent, and engaging. Structure it with these sections: [Intro Music], Introduction, Main Segment 1, Main Segment 2, [Musical Interlude], Practical Application, Conclusion, Outro, [Outro Music].`;
        } else { // Sermon
            prompt = `You are a homilist for "${BRAND_INFO.name}". Tone must be: ${BRAND_INFO.tone}. Sermon Topic: "${selectedIdea.title}". Central Idea: "${selectedIdea.description}". Generate a well-structured homily outline for a 10-15 minute talk. It must include these sections: Title, Opening (The Hook), Scriptural Foundation, Exegesis (The Core Teaching), Theological Connection (The 'Why'), Practical Application (The 'Now What'), and Conclusion.`;
        }

        try {
            const result = await callGemini(prompt);
            setGeneratedContent(result);
            // Fetch book recommendations after content is generated
            setIsLoadingBooks(true);
            const books = await getRecommendedBooks(selectedIdea.title + "\n\n" + result);
            setRecommendedBooks(books);
        } catch(e) {
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to generate content: ${e.message}`} onClose={() => setModal({ isOpen: false, content: null })} /> });
        } finally {
            setLoading(false);
            setIsLoadingBooks(false);
        }
    };

    const handleSave = async () => {
        if (!generatedContent || !selectedIdea) return;
        await onCreateProject(contentType, selectedIdea.title, generatedContent);
    };

    const handleExport = async () => {
        if (!generatedContent || !selectedIdea || contentType !== 'podcast') return;
        setIsExporting(true);

        const prompt = `You are a podcast production assistant for "${BRAND_INFO.name}". Your task is to take a draft podcast script and format it for production. Add detailed speaker notes in parentheses for tone and pacing (e.g., "(thoughtfully)", "(upbeat)"), and suggest specific sound effects or music cues using bracketed labels (e.g., "[SFX: gentle page turn]", "[MUSIC: reflective piano fades in]"). Ensure the final output is a clean, production-ready script. Here is the draft:\n\n---\n\n${generatedContent}`;

        try {
            const refinedScript = await callGemini(prompt);
            await onCreateProject(contentType, `${selectedIdea.title} (Production Script)`, refinedScript);
        } catch (e) {
            setModal({ isOpen: true, content: <AlertModal title="AI Export Error" message={`Failed to create refined script: ${e.message}`} onClose={() => setModal({ isOpen: false, content: null })} /> });
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div>
            {step === 'brainstorm' && (
                <div className="animate-fade-in">
                    <p className="text-gray-300 mt-1 mb-4">Start with a theme to generate a list of content ideas for sermons or podcasts.</p>
                    <div className="flex gap-2">
                        <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Enter a theme, e.g., 'Theosis' or 'Liturgical Year'" className="w-full p-3 bg-[#002244] border border-[#D4AF37]/30 rounded-md focus:ring-2 focus:ring-[#D4AF37] focus:outline-none text-white" />
                        <button onClick={generateIdeas} disabled={loading || !topic} className="bg-[#800020] text-white font-bold py-3 px-4 rounded-md hover:bg-[#800020]/80 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors duration-300 flex items-center justify-center">
                            <Wand2 className="mr-2"/> {loading ? 'Generating...' : 'Brainstorm'}
                        </button>
                    </div>
                </div>
            )}

            {step !== 'brainstorm' && (
                <div className="text-right mb-4">
                    <button onClick={handleStartOver} className="text-sm text-[#D4AF37] hover:text-yellow-200">&larr; Start Over</button>
                </div>
            )}

            {loading && step !== 'brainstorm' && <LoadingSpinner message="Please wait..." />}

            {step === 'select' && !loading && (
                <div className="animate-fade-in">
                    <h3 className="text-xl font-semibold text-center text-white mb-4">Select an Idea to Develop</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {ideas.map((idea, index) => (
                            <button key={index} onClick={() => handleSelectIdea(idea)} className="text-left p-4 bg-[#002244]/60 rounded-lg border border-[#D4AF37]/30 hover:border-[#D4AF37] hover:bg-[#002244] transition-all duration-200">
                                <h4 className="font-bold text-[#D4AF37]">{idea.title}</h4>
                                <p className="text-sm text-gray-400 mt-1">{idea.description}</p>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {step === 'develop' && selectedIdea && !generatedContent && !loading && (
                <div className="animate-fade-in">
                    <div className="p-4 bg-[#D4AF37]/10 rounded-lg border border-[#D4AF37]/30 text-center">
                        <p className="text-sm text-yellow-200">Selected Idea:</p>
                        <h3 className="text-xl font-bold text-white">{selectedIdea.title}</h3>
                    </div>
                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <button onClick={() => developContent('podcast')} disabled={loading} className="p-4 bg-blue-600/80 text-white font-bold rounded-lg hover:bg-blue-600 disabled:bg-gray-600 flex items-center justify-center transition-colors">
                            <Mic className="mr-3"/> Develop as Podcast
                        </button>
                        <button onClick={() => developContent('sermon')} disabled={loading} className="p-4 bg-green-600/80 text-white font-bold rounded-lg hover:bg-green-600 disabled:bg-gray-600 flex items-center justify-center transition-colors">
                            <BookOpen className="mr-3"/> Develop as Sermon
                        </button>
                    </div>
                </div>
            )}
            
            {loading && (step === 'develop' || step === 'brainstorm') && <LoadingSpinner message={loading ? "Generating..." : ""} />}

            {generatedContent && !loading && (
                <div className="animate-fade-in">
                    <StudioResultCard 
                        title={`${contentType.charAt(0).toUpperCase() + contentType.slice(1)} for "${selectedIdea.title}"`} 
                        content={generatedContent}
                        onSave={handleSave}
                        onDelete={() => setGeneratedContent('')}
                        onExport={handleExport}
                        isExporting={isExporting}
                        contentType={contentType}
                        recommendedBooks={recommendedBooks} // Pass books
                        isLoadingBooks={isLoadingBooks} // Pass loading state
                    />
                </div>
            )}
        </div>
    );
};

const StudioChantLyricist = ({ onCreateProject, setModal }) => {
    const [theme, setTheme] = useState('');
    const [lyrics, setLyrics] = useState('');
    const [soundDescription, setSoundDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingSound, setLoadingSound] = useState(false);
    const [lyricIdeas, setLyricIdeas] = useState([]);
    const [loadingIdeas, setLoadingIdeas] = useState(false);
    const [recommendedBooks, setRecommendedBooks] = useState([]); // New state for books
    const [isLoadingBooks, setIsLoadingBooks] = useState(false); // New state for loading books

    const brainstormLyricIdeas = async () => {
        if (!theme) return;
        setLoadingIdeas(true);
        setLyricIdeas([]);
        setLyrics('');
        setSoundDescription('');
        setRecommendedBooks([]);
        setIsLoadingBooks(false);

        const prompt = `You are a creative assistant for "${BRAND_INFO.name}". Based on the theme "${theme}", brainstorm 5 specific, evocative, and theologically rich lyrical concepts or titles suitable for an Ethiopian Orthodox Tewahedo chant.`;
        const schema = { type: "OBJECT", properties: { ideas: { type: "ARRAY", items: { type: "OBJECT", properties: { title: { type: "STRING" }, description: { type: "STRING" } }, required: ["title", "description"] } } }, required: ["ideas"] };

        try {
            const resultText = await callGemini(prompt, schema);
            const resultJson = JSON.parse(resultText);
            if (resultJson.ideas) {
                setLyricIdeas(resultJson.ideas);
            }
        } catch (e) {
            console.error("Failed to parse lyric ideas:", e);
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Could not brainstorm ideas: ${e.message}`} onClose={() => setModal({ isOpen: false, content: null })} /> });
        }
        setLoadingIdeas(false);
    };

    const generateLyrics = async () => {
        if (!theme) return;
        setLoading(true);
        setLyrics('');
        setLyricIdeas([]);
        setSoundDescription('');
        setRecommendedBooks([]);
        setIsLoadingBooks(false);

        const prompt = `You are a lyricist specializing in the tradition of the Ethiopian Orthodox Tewahedo Church (EOTC). Your task is to generate original chant lyrics in English based on the theme: "${theme}". The total length should be appropriate for a song of roughly 3-4 minutes. CRITICAL STRUCTURE REQUIREMENTS: The output must be clearly structured with labels: "[Verse 1]", "[Chorus]", "[Verse 2]", etc. There must be a repeating [Chorus] after each verse. Each line of the verses and chorus must be between 3 and 5 words long. Do not generate more than 4 verses. Use imagery and language consistent with EOTC hymnography.`;

        try {
            const result = await callGemini(prompt);
            setLyrics(result);
            // Fetch book recommendations after content is generated
            setIsLoadingBooks(true);
            const books = await getRecommendedBooks(theme + "\n\n" + result);
            setRecommendedBooks(books);
        } catch(e) {
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to generate lyrics: ${e.message}`} onClose={() => setModal({ isOpen: false, content: null })} /> });
        } finally {
            setLoading(false);
            setIsLoadingBooks(false);
        }
    };

    const generateSoundDescription = async () => {
        if (!lyrics) return;
        setLoadingSound(true);
        const prompt = `You are a music producer and ethnomusicologist specializing in sacred music, particularly Ethiopian Orthodox Tewahedo chant. Based on the following lyrics and theme, describe the ideal sound, mood, and instrumentation for a chant. Be descriptive and evocative, mentioning specific traditional instruments like the kebero drum, masenqo, or tsenatsel where appropriate. Keep the entire description under 3000 characters. \n\nTheme: "${theme}"\n\nLyrics:\n"${lyrics.substring(0, 2000)}"`;
        
        try {
            const result = await callGemini(prompt);
            setSoundDescription(result);
        } catch(e) {
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to generate sound description: ${e.message}`} onClose={() => setModal({ isOpen: false, content: null })} /> });
        }
        setLoadingSound(false);
    };

    const handleSave = async () => {
        if (!lyrics || !theme) return;
        let fullContent = lyrics;
        if (soundDescription) {
            fullContent += `\n\n---\n\n### Sound Description\n\n${soundDescription}`;
        }
        await onCreateProject('lyrics', `Chant Lyrics: ${theme}`, fullContent);
    };

    return (
        <div>
            <p className="text-gray-300 mt-1 mb-4">Brainstorm ideas, then generate your lyrics.</p>
            <div className="flex gap-2">
                <input
                    type="text"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                    placeholder="Enter a lyrical theme, e.g., 'The Cross of Christ'"
                    className="w-full p-3 bg-[#002244] border border-[#D4AF37]/30 rounded-md focus:ring-2 focus:ring-[#D4AF37] focus:outline-none text-white"
                />
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                    onClick={brainstormLyricIdeas}
                    disabled={loadingIdeas || !theme}
                    className="w-full bg-[#D4AF37]/80 text-black font-bold py-3 px-4 rounded-md hover:bg-[#D4AF37] disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors duration-300 flex items-center justify-center"
                >
                    <Lightbulb className="mr-2"/> {loadingIdeas ? 'Brainstorming...' : 'Brainstorm Lyric Ideas'}
                </button>
                <button
                    onClick={generateLyrics}
                    disabled={loading || !theme}
                    className="w-full bg-[#800020] text-white font-bold py-3 px-4 rounded-md hover:bg-[#800020]/80 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors duration-300 flex items-center justify-center"
                >
                    <Music className="mr-2"/> {loading ? 'Composing...' : 'Generate Lyrics'}
                </button>
            </div>

            {loadingIdeas && <LoadingSpinner message="Brainstorming ideas..." />}
            {lyricIdeas.length > 0 && (
                <div className="mt-6 animate-fade-in">
                    <h3 className="text-xl font-semibold text-center text-white mb-4">Select a Lyrical Idea</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {lyricIdeas.map((idea, index) => (
                            <button key={index} onClick={() => { setTheme(idea.title); setLyricIdeas([]); }} className="text-left p-4 bg-[#002244]/60 rounded-lg border border-[#D4AF37]/30 hover:border-[#D4AF37] hover:bg-[#002244] transition-all duration-200">
                                <h4 className="font-bold text-[#D4AF37]">{idea.title}</h4>
                                <p className="text-sm text-gray-400 mt-1">{idea.description}</p>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {loading && <LoadingSpinner message="Composing lyrics..." />}
            
            {lyrics && !loading && (
                <div className="animate-fade-in">
                    <StudioResultCard 
                        title={`Chant Lyrics: ${theme}`} 
                        content={lyrics}
                        onSave={handleSave}
                        onDelete={() => {setLyrics(''); setSoundDescription('');}}
                        onGenerateSound={generateSoundDescription}
                        soundDescription={soundDescription}
                        loadingSound={loadingSound}
                        contentType="lyrics"
                        recommendedBooks={recommendedBooks} // Pass books
                        isLoadingBooks={isLoadingBooks} // Pass loading state
                    />
                </div>
            )}
        </div>
    );
};

const StudioResultCard = ({ title, content, onSave, onDelete, onGenerateSound, soundDescription, loadingSound, onExport, isExporting, contentType, recommendedBooks, isLoadingBooks }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = (textToCopy) => {
        const textArea = document.createElement("textarea");
        textArea.value = textToCopy;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Fallback: Oops, unable to copy', err);
        }
        document.body.removeChild(textArea);
    };

    return (
        <div className="mt-6 bg-[#002244]/50 p-6 rounded-lg border border-[#D4AF37]/20 shadow-lg animate-fade-in relative">
            <div className="absolute top-4 right-4 flex space-x-3">
                <button onClick={() => handleCopy(content)} className="text-gray-400 hover:text-green-400 transition-colors" title={copied ? "Copied!" : "Copy Content"}>
                    {copied ? <Check className="h-5 w-5 text-green-400" /> : <ClipboardIcon className="h-5 w-5" />}
                </button>
                {onDelete && (
                    <button onClick={onDelete} className="text-gray-400 hover:text-red-400 transition-colors" title="Delete">
                        <Trash2 className="h-5 w-5" />
                    </button>
                )}
            </div>
            <h3 className="text-lg font-semibold text-[#D4AF37] mb-3 pr-20">{title}</h3>
            <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap text-gray-300" dangerouslySetInnerHTML={{ __html: content.replace(/\n/g, '<br />') }}></div>
            
            {loadingSound && <div className="mt-4"><LoadingSpinner message="Generating sound description..." /></div>}

            {soundDescription && !loadingSound && (
                <div className="mt-4 pt-4 border-t border-[#D4AF37]/20">
                    <h4 className="font-semibold text-[#D4AF37] mb-2 flex items-center gap-2"><Wind size={16}/> Sound Description</h4>
                    <p className="text-sm text-gray-400 whitespace-pre-wrap">{soundDescription}</p>
                </div>
            )}

            {isLoadingBooks && <div className="mt-4"><LoadingSpinner message="Finding book recommendations..." /></div>}
            {!isLoadingBooks && recommendedBooks && recommendedBooks.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[#D4AF37]/20">
                    <h4 className="font-semibold text-[#D4AF37] mb-2 flex items-center gap-2"><Book size={16}/> Recommended Books</h4>
                    <ul className="list-disc list-inside text-sm text-gray-400 space-y-1">
                        {recommendedBooks.map((book, index) => (
                            <li key={index}>"{book.title}" by {book.author}</li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="mt-6 flex justify-between items-center flex-wrap gap-2">
                <div className="flex items-center gap-2">
                    {onGenerateSound && !soundDescription && (
                        <button onClick={onGenerateSound} disabled={loadingSound} className="bg-blue-600 text-white font-medium py-2 px-3 rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center text-sm disabled:bg-gray-600">
                            <Wind className="mr-2" size={16}/> {loadingSound ? 'Generating...' : 'Describe Sound'}
                        </button>
                    )}
                    {contentType === 'podcast' && onExport && (
                        <button onClick={onExport} disabled={isExporting} className="bg-purple-600 text-white font-medium py-2 px-3 rounded-md hover:bg-purple-700 transition-colors flex items-center justify-center text-sm disabled:bg-gray-600">
                            <Share2 className="mr-2" size={16}/> {isExporting ? 'Exporting...' : 'Smart Export'}
                        </button>
                    )}
                </div>
                <button onClick={onSave} className="bg-[#800020] text-white font-bold py-2 px-4 rounded-md hover:bg-[#800020]/80 transition-colors flex items-center justify-center ml-auto">
                    <Save className="mr-2" size={16}/> Save as Project
                </button>
            </div>
        </div>
    );
};


// --- EXISTING VIEW COMPONENTS (Editor, Chatbot, Scheduler, Modals, etc.) ---
const EditorView = ({ project, onSave, onDelete, setModal, onCreateProject, db, userId, storage }) => {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [chapterTitleInput, setChapterTitleInput] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [aiLoading, setAiLoading] = useState('');
    const [parsedScript, setParsedScript] = useState(null);
    const [viewMode, setViewMode] = useState('edit'); // 'edit' or 'preview'
    const [selectedText, setSelectedText] = useState('');
    const editorRef = useRef(null);

    useEffect(() => {
        if (project) {
            setTitle(project.title || '');
            setContent(project.content || '');
            setParsedScript(null); // Reset breakdown on new project
            setViewMode('edit'); // Reset to edit mode when a new project is selected
        }
    }, [project]);

    if (!project) return <div className="text-center text-gray-400">Select a project to start editing, or create one from the Content Studio.</div>;

    const handleSave = async () => {
        setIsSaving(true);
        await onSave({ ...project, title, content });
        setIsSaving(false);
    };

    const handleSelectText = () => {
        const textarea = editorRef.current;
        if (textarea) {
            setSelectedText(textarea.value.substring(textarea.selectionStart, textarea.selectionEnd));
        }
    };
    
    const handleSpeakText = async (textToSpeak) => {
        if (!textToSpeak) return;
        setAiLoading('tts');
        try {
            const audioUrl = await callGeminiTTS(textToSpeak);
            setModal({
                isOpen: true,
                content: <TTSPlayerModal
                    textToSpeak={textToSpeak}
                    onClose={() => setModal({ isOpen: false, content: null })}
                />
            });
        } catch (error) {
            console.error("TTS Error:", error);
            setModal({ isOpen: true, content: <AlertModal title="TTS Error" message={`Failed to generate audio: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
        } finally {
            setAiLoading('');
        }
    };

    const handleGetPatristicInsight = async (text) => {
        if (!text) return;
        setAiLoading('insight');
        const prompt = `You are a Patristic scholar. Provide a brief, reverent, and insightful commentary on the following text from the perspective of the Church Fathers and Ethiopian Orthodox Tewahedo tradition. Focus on key theological points and provide a short, clear explanation. Do not exceed 200 words. \n\nText:\n${text}`;

        try {
            const insight = await callGemini(prompt);
            setModal({
                isOpen: true,
                content: <PatristicInsightModal
                    insight={insight}
                    onClose={() => setModal({ isOpen: false, content: null })}
                />
            });
        } catch (error) {
            console.error("Insight Error:", error);
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to generate insight: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
        } finally {
            setAiLoading('');
        }
    };

    const renderMarkdown = (markdown) => {
        const html = marked.parse(markdown);
        return DOMPurify.sanitize(html);
    };

    const handleAIAction = async (action) => {
        setAiLoading(action);
        let prompt;
        // This switch statement builds the prompt based on the action
        switch(action) {
            case 'coach_sermon':
                setModal({isOpen: true, content: <SermonCoachModal sermonTitle={title} sermonContent={content} onClose={() => setModal({isOpen: false, content: null})} setModal={setModal} onCreateProject={onCreateProject} /> });
                setAiLoading('');
                return;
            case 'outline':
                // Separate logic for blog outline
                if (project.type === 'blog') {
                    prompt = `You are a writer for "Ancient Truths, Modern Times," a blog focused on making Ethiopian Orthodox Tewahedo theology and spirituality accessible. Your tone is reverent, insightful, and clear (around a grade 8 reading level). Generate a detailed outline for a blog post based on the title: "${title}". The outline should include a clear introduction, 3-5 main sections with sub-points, and a conclusion with a practical takeaway. Please provide the output in markdown format.`;
                }
                else if (project.type === 'sermon') {
                    prompt = `You are an assistant for "Ancient Truths, Modern Times," a platform focused on Ethiopian Orthodox Tewahedo theology. Generate a sermon outline for the title: "${title}". The outline should be suitable for a homily, including an introduction (Exordium), key scriptural points to expound upon, suggestions for patristic references, a section on modern application, and a conclusion (Peroratio). Please provide the output in markdown format.`;
                } else if (project.type === 'series') {
                    prompt = `You are an assistant for "Ancient Truths, Modern Times." Generate a multi-part series outline for the title: "${title}". The outline should propose 3-5 parts, each with its own title and a brief one-sentence description. Format the output in markdown.`;
                } else if (project.type === 'devotional') {
                    prompt = `Generate a simple outline for a short devotional email on the topic: "${title}". The outline should include a key scripture or quote, a short reflection, and a prayer prompt. Format as markdown.`
                } else if (project.type === 'ebooks') {
                    prompt = `Generate a detailed table of contents for an e-book titled "${title}". The audience is interested in Ethiopian Orthodox Tewahedo theology. The table of contents should include a foreword, an introduction, several chapters with descriptive titles, and a conclusion. Format as markdown.`
                } else if (project.type === 'courses') {
                    prompt = `Generate a course curriculum for a course titled "${title}". The audience is interested in Ethiopian Orthodox Tewahedo theology. The curriculum should be structured into modules, with each module containing several lesson titles. Format the output in markdown.`
                } else if (project.type === 'videos') {
                    prompt = `Generate a video script outline for a video titled "${title}". The structure should include a Hook, Introduction, Main Points (3-4), B-Roll suggestions, a Call to Action, and an Outro. Format as markdown.`
                } else if (project.type === 'series') {
                    prompt = `You are a writer for "Ancient Truths, Modern Times." Your task is to expand on the provided series outline. For each part listed in the outline, write a full, detailed section of content (around 200-300 words). Maintain a reverent and accessible tone. \n\n**Series Title:** "${title}"\n\n**Outline:**\n${content}`;
                } 
                break;
            case 'write_full_post':
                // Separate logic for writing full blog post
                if (project.type === 'blog') {
                    prompt = `You are a writer for "Ancient Truths, Modern Times," a blog focused on making Ethiopian Orthodox Tewahedo theology and spirituality accessible. Your tone is reverent, insightful, and clear (around a grade 8 reading level). Write a full, ready-to-publish blog post based on the following title and outline. Expand on each point in the outline, provide context, scripture references where appropriate, and conclude with a practical takeaway for modern life. \n\n**Title:** "${title}"\n\n**Outline:**\n${content}`;
                }
                else if (project.type === 'sermon') {
                    prompt = `You are a homilist for "Ancient Truths, Modern Times," a platform focused on Ethiopian Orthodox Tewahedo theology. Your tone is pastoral, reverent, and clear, suitable for oral delivery. Write a full, ready-to-preach sermon manuscript based on the following title and homiletic outline. Flesh out each section, weaving in scriptural exegesis, patristic wisdom, and practical application for the congregation. Ensure the language flows well when spoken. \n\n**Title:** "${title}"\n\n**Outline:**\n${content}`;
                } else if (project.type === 'podcast') {
                    prompt = `You are a scriptwriter for "${BRAND_INFO.name}". Tone: ${BRAND_INFO.tone}. Write a full podcast script based on the title "${title}" and the following outline/content:\n\n${content}`;
                } else if (project.type === 'devotional') {
                    prompt = `You are a writer for "Ancient Truths, Modern Times." Write a short, pastoral, and reflective devotional email (around 200-250 words) based on the following title and outline. Your tone should be warm and encouraging. \n\n**Title:** "${title}"\n\n**Outline:**\n${content}`;
                } else if (project.type === 'ebooks') {
                    prompt = `You are a writer for "Ancient Truths, Modern Times." Write a compelling introduction for the e-book titled "${title}", based on the provided table of contents. The introduction should hook the reader, explain the book's purpose, and give an overview of the chapters to come. \n\n**Table of Contents:**\n${content}`;
                } else if (project.type === 'courses') {
                    prompt = `You are an educator for "Ancient Truths, Modern Times." Write an engaging welcome message for the course titled "${title}", based on the provided curriculum. The welcome should excite the student, set expectations, and briefly introduce the modules. \n\n**Full Curriculum:**\n${content}`;
                } else if (project.type === 'videos') {
                    prompt = `You are a scriptwriter for "Ancient Truths, Modern Times." Write a full, engaging video script based on the title and outline provided. The script should be written in a natural, spoken-word style. Include cues for visuals (B-roll), narration, and sound effects using the prefixes "VISUAL:", "NARRATOR:", and "SFX:". \n\n**Title:** "${title}"\n\n**Outline:**\n${content}`;
                } else if (project.type === 'series') {
                    prompt = `You are a writer for "Ancient Truths, Modern Times." Your task is to expand on the provided series outline. For each part listed in the outline, write a full, detailed section of content (around 200-300 words). Maintain a reverent and accessible tone. \n\n**Series Title:** "${title}"\n\n**Outline:**\n${content}`;
                } 
                break;
            case 'write_chapter':
                if (project.type === 'ebooks' && chapterTitleInput) {
                    prompt = `You are an author for "Ancient Truths, Modern Times." Your task is to write a full chapter for an e-book titled "${project.title}". The full table of contents is provided below for context. Your **sole task** is to write the complete text for the chapter titled: "${chapterTitleInput}". **Do not** write any other chapters or repeat content from other chapter titles listed in the table of contents. The chapter should be detailed, insightful, well-structured, and written in a reverent and accessible tone suitable for the target audience. \n\n**Full Table of Contents:**\n${content.substring(0,4000)}\n\n**Chapter to Write:**\n${chapterTitleInput}`;
                } else if (project.type === 'courses' && chapterTitleInput) {
                    prompt = `You are an educator for "Ancient Truths, Modern Times." Your task is to write the full lesson content for a course titled "${project.title}". The full curriculum is provided below for context. Your **sole task** is to write the complete text for the lesson titled: "${chapterTitleInput}". The lesson should be clear, informative, and engaging for the target audience. \n\n**Full Curriculum:**\n${content.substring(0,4000)}\n\n**Lesson to Write:**\n${chapterTitleInput}`;
                } else if (project.type === 'series' && chapterTitleInput) {
                    prompt = `You are a writer for "Ancient Truths, Modern Times." Your task is to write the full content for a part of a series titled "${project.title}". The full series outline is provided below for context. Your **sole task** is to write the complete text for the part titled: "${chapterTitleInput}". The content should be detailed, insightful, well-structured, and written in a reverent and accessible tone suitable for the target audience. \n\n**Full Series Outline:**\n${content.substring(0,4000)}\n\n**Part to Write:**\n${chapterTitleInput}`;
                }
                break;
            case 'breakdown_script':
                prompt = `Analyze the following video script. Extract all lines that begin with "VISUAL:", "NARRATOR:", and "SFX:". Return the result as a single, valid JSON object with three keys: "visuals", "narration", and "sfx". Each key should contain an an array of strings. Do not include the prefixes in the returned strings. \n\n**Script:**\n${content}`;
                break;
            case 'copy_edit':
                prompt = `You are a meticulous copy editor for "Ancient Truths, Modern Times," a blog with a reverent and accessible tone. Review the following blog post. Correct any grammatical errors, spelling mistakes, or punctuation issues. Improve sentence structure and flow for better readability, but do not change the core theological message or the overall meaning. Return only the final, polished text. \n\n**Post:**\n${content}`;
                break;
            case 'improve':
                prompt = `Improve the following text for clarity, engagement, and reverence, in the style of a faith-based storyteller for the 'Ancient Truths, Modern Times' blog. Keep the core message intact:\n\n${content}`;
                break;
            case 'summarize':
                prompt = `Summarize the following text into a few key bullet points, using markdown:\n\n${content}`;
                break;
            case 'translate_amharic':
                prompt = `You are an expert translator specializing in theological and spiritual texts for the Ethiopian Orthodox Tewahedo Church. Translate the following English text into Amharic, ensuring the tone is reverent and the theological terms are accurate. Return only the translated Amharic text.\n\n**English Text:**\n${content}`;
                break;
            case 'generate_image_prompt':
                prompt = `You are an expert prompt engineer for an image generation model. Based on the following text, create a detailed, visually descriptive prompt that captures the core essence of the text in a single, evocative paragraph. The prompt should describe the scene, style, lighting, and mood. Return only the generated prompt text.\n\n**Text:**\n${content}`;
                break;
            case 'create_image':
                prompt = `Summarize the following text into a short, visually descriptive phrase suitable for an image generation model. The phrase should capture the core essence of the text in a single, evocative sentence. Return only the phrase.\n\n**Text:**\n${content}`;
                break;
            default:
                setAiLoading('');
                return;
        }

        let imagePrompt = ''; // Declare imagePrompt outside the try block
        try {
            let response;
            if (action === 'breakdown_script') {
                const schema = { type: "OBJECT", properties: { visuals: { type: "ARRAY", items: { type: "STRING" } }, narration: { type: "ARRAY", items: { type: "STRING" } }, sfx: { type: "ARRAY", items: { type: "STRING" } } } };
                response = await callGemini(prompt, schema);
                setParsedScript(JSON.parse(response));
            } else if (action === 'create_image') {
                imagePrompt = await callGemini(prompt);
                setModal({isOpen: true, content: <GeneratedPromptModal promptText={imagePrompt} onClose={() => setModal({isOpen: false, content: null})} setModal={setModal} /> });
            } else if (action === 'generate_image_prompt') {
                const generatedPrompt = await callGemini(prompt);
                setModal({
                    isOpen: true,
                    content: <GeneratedPromptModal 
                        promptText={generatedPrompt}
                        onClose={() => setModal({isOpen: false, content: null})}
                        setModal={setModal}
                    />
                });
            }
            else {
                response = await callGemini(prompt);
                if (action === 'summarize') {
                    setContent(prev => `${prev}\n\n---\n\n**✨ AI Summary:**\n\n${response}`);
                } else if (action === 'write_chapter') {
                    const newContent = content.replace(chapterTitleInput, `${chapterTitleInput}\n\n${response}`);
                    setContent(newContent);
                    setChapterTitleInput('');
                } else {
                    setContent(response);
                }
            }
        } catch (error) {
             if (action === 'create_image') {
                setModal({
                    isOpen: true, 
                    content: <GeneratedImageVariationsModal 
                        error={error.message}
                        prompt={imagePrompt || 'Could not generate prompt from content.'}
                        onClose={() => setModal({isOpen: false, content: null})} 
                        setModal={setModal} 
                    /> 
                });
            } else {
                setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to perform AI action: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
            }
        } finally {
            setAiLoading('');
        }
    };

    const openRepurposeModal = () => {
        setModal({
            isOpen: true,
            content: <RepurposeModal 
                contentToRepurpose={content} 
                title={title} 
                onClose={() => setModal({ isOpen: false, content: null })} 
                setModal={setModal} 
                onCreateProject={onCreateProject} 
            />
        });
    };

    const handleGetBookRecommendations = () => {
        setModal({
            isOpen: true,
            content: <BookRecommendationsModal
                topicOrContent={content || title}
                onClose={() => setModal({ isOpen: false, content: null })}
            />
        });
    };

    const getOutlineButtonLabel = () => {
        switch (project.type) {
            case 'blog': return '1. Blog Outline'; // Specific for blog
            case 'sermon': return '1. Sermon Outline';
            case 'podcast': return '1. Podcast Outline';
            case 'series': return '1. Series Outline';
            case 'devotional': return '1. Devotional Outline';
            case 'ebooks': return '1. Create Table of Contents';
            case 'courses': return '1. Create Course Outline';
            case 'videos': return '1. Create Script Outline';
            default: return '1. Outline'; // Fallback
        }
    };
    
    const getWriteButtonLabel = () => {
        switch (project.type) {
            case 'blog': return '2. Write Full Post'; // Specific for blog
            case 'sermon': return '2. Write Full Sermon';
            case 'podcast': return '2. Write Full Script';
            case 'series': return '2. Expand on Outline';
            case 'devotional': return '2. Write Full Devotional';
            case 'ebooks': return '2. Write Introduction';
            case 'courses': return '2. Write Course Welcome';
            case 'videos': return '2. Write Full Script';
            default: return '2. Write Full Content'; // Fallback
        }
    };

    const partName = useMemo(() => {
        switch(project.type) {
            case 'ebooks': return 'chapter';
            case 'courses': return 'lesson';
            case 'series': return 'part';
            default: return null;
        }
    }, [project.type]);

    return (
        <div className="flex flex-col h-full animate-fade-in">
            <div className="flex-shrink-0 flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-4">
                <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="text-2xl font-bold bg-transparent text-white focus:outline-none w-full"
                    placeholder="Your Title Here"
                />
                <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={handleSave} disabled={isSaving} className="px-4 py-2 text-sm font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 disabled:opacity-50 flex items-center gap-2">
                        {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                        <span>{isSaving ? 'Saving...' : 'Save'}</span>
                    </button>
                    <button onClick={() => onDelete(project.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-[#800020]/50 rounded-full">
                        <Trash2 size={18} />
                    </button>
                </div>
            </div>
            
            <div className="flex-shrink-0 flex flex-col gap-2 mb-4 p-2 bg-[#002244]/50 rounded-lg border border-[#D4AF37]/20">
                <div className="flex items-center flex-wrap gap-2">
                    <span className="text-sm font-semibold text-[#D4AF37] flex items-center gap-2 mr-2"><Sparkles size={16} /> AI Writing Tools:</span>
                    <AIButton label={getOutlineButtonLabel()} action="outline" onClick={handleAIAction} isLoading={aiLoading === 'outline'} />
                    <AIButton label={getWriteButtonLabel()} action="write_full_post" onClick={handleAIAction} isLoading={aiLoading === 'write_full_post'} icon={FileText}/>
                    {project.type === 'sermon' && content && <AIButton label="✨ Sermon Coach" action="coach_sermon" onClick={handleAIAction} isLoading={aiLoading === 'coach_sermon'} icon={Megaphone} />}
                    {project.type === 'videos' && content && <AIButton label="✨ Breakdown Script" action="breakdown_script" onClick={handleAIAction} isLoading={aiLoading === 'breakdown_script'} icon={Scissors} />}
                    <AIButton label="3. AI Copy Edit" action="copy_edit" onClick={handleAIAction} isLoading={aiLoading === 'copy_edit'} icon={CheckCircle}/>
                    <AIButton label="Improve" action="improve" onClick={handleAIAction} isLoading={aiLoading === 'improve'} />
                    <AIButton label="Summarize" action="summarize" onClick={handleAIAction} isLoading={aiLoading === 'summarize'} />
                    <AIButton label="Translate to Amharic" action="translate_amharic" onClick={handleAIAction} isLoading={aiLoading === 'translate_amharic'} icon={Languages} />
                    <AIButton label="Generate Image Prompt" action="generate_image_prompt" onClick={handleAIAction} isLoading={aiLoading === 'generate_image_prompt'} icon={Lightbulb} />
                    <AIButton label="Create Image from Content" action="create_image" onClick={handleAIAction} isLoading={aiLoading === 'create_image'} icon={ImageIcon} />
                    <button onClick={openRepurposeModal} className="px-3 py-1 text-xs font-medium text-gray-300 bg-gray-700 rounded-md hover:bg-gray-600 flex items-center gap-1.5">
                        <GitBranch size={12} />
                        Repurpose & Share
                    </button>
                </div>
                <div className="flex items-center flex-wrap gap-2 pt-2 border-t border-[#D4AF37]/20">
                    <span className="text-sm font-semibold text-[#D4AF37] flex items-center gap-2 mr-2">TTS & Insight:</span>
                    <AIButton label="Listen to Draft" action="listen_to_draft" onClick={() => handleSpeakText(selectedText || content)} isLoading={aiLoading === 'tts'} icon={Headphones} />
                    <AIButton label="Get Quick Insight" action="get_quick_insight" onClick={() => handleGetPatristicInsight(selectedText)} isLoading={aiLoading === 'insight'} icon={BookOpen} disabled={!selectedText} />
                    <AIButton label="Get Book Recommendations" action="get_book_recommendations" onClick={handleGetBookRecommendations} isLoading={aiLoading === 'get_book_recommendations'} icon={Book} />
                </div>
                {partName && (
                    <div className="flex items-center gap-2 pt-2 border-t border-[#D4AF37]/20">
                        <input
                            type="text"
                            value={chapterTitleInput}
                            onChange={(e) => setChapterTitleInput(e.target.value)}
                            placeholder={`Copy & paste a ${partName} title here to write it`}
                            className="flex-grow w-full bg-[#002244] border border-[#D4AF37]/30 rounded-md px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37]"
                        />
                        <AIButton label={`Write ${partName.charAt(0).toUpperCase() + partName.slice(1)}`} action="write_chapter" onClick={handleAIAction} isLoading={aiLoading === 'write_chapter'} icon={FileText} />
                    </div>
                )}
            </div>

            {/* Content Area with Edit/Preview Toggle */}
            <div className="flex-grow flex flex-col">
                <div className="flex-shrink-0 flex justify-end mb-2">
                    <div className="inline-flex rounded-md shadow-sm" role="group">
                        <button
                            type="button"
                            onClick={() => setViewMode('edit')}
                            className={`px-4 py-2 text-sm font-medium rounded-l-lg ${viewMode === 'edit' ? 'bg-[#D4AF37] text-black' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                        >
                            Edit
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('preview')}
                            className={`px-4 py-2 text-sm font-medium rounded-r-lg ${viewMode === 'preview' ? 'bg-[#D4AF37] text-black' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                        >
                            Preview
                        </button>
                    </div>
                </div>

                {viewMode === 'edit' ? (
                    <textarea
                        ref={editorRef}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        onSelect={handleSelectText}
                        className="flex-grow w-full p-4 bg-[#002244]/50 text-gray-300 rounded-lg border border-[#D4AF37]/20 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] resize-none leading-relaxed"
                        placeholder="Start writing your masterpiece..."
                    />
                ) : (
                    <div
                        className="flex-grow w-full p-4 bg-[#002244]/50 text-gray-300 rounded-lg border border-[#D4AF37]/20 overflow-y-auto prose prose-invert prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
                    />
                )}
            </div>

            {parsedScript && <ScriptBreakdownView script={parsedScript} />}
        </div>
    );
};

const ScriptBreakdownView = ({ script }) => {
    const copyToClipboard = (text) => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
        } catch (err) {
            console.error('Fallback: Oops, unable to copy', err);
        }
        document.body.removeChild(textArea);
    };

    return (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <BreakdownColumn title="Visuals" items={script.visuals} onCopy={() => copyToClipboard(script.visuals.join('\n'))} />
            <BreakdownColumn title="Narration" items={script.narration} onCopy={() => copyToClipboard(script.narration.join('\n'))} />
            <BreakdownColumn title="SFX" items={script.sfx} onCopy={() => copyToClipboard(script.sfx.join('\n'))} />
        </div>
    );
};

const BreakdownColumn = ({ title, items, onCopy }) => {
    const [copied, setCopied] = useState(false);
    
    const handleCopy = () => {
        onCopy();
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="bg-[#002244]/50 rounded-lg border border-[#D4AF37]/20 flex flex-col">
            <div className="flex justify-between items-center p-3 border-b border-[#D4AF37]/20">
                <h3 className="font-semibold text-[#D4AF37]">{title}</h3>
                <button onClick={handleCopy} className="text-xs flex items-center gap-1 text-gray-400 hover:text-white">
                    <ClipboardCopy size={14} />
                    {copied ? 'Copied!' : 'Copy All'}
                </button>
            </div>
            <ul className="p-3 space-y-2 overflow-y-auto h-48">
                {(items || []).map((item, index) => (
                    <li key={index} className="text-sm text-gray-300 border-b border-[#D4AF37]/10 pb-1 last:border-b-0">{item}</li>
                ))}
            </ul>
        </div>
    );
};


const AIButton = ({ label, action, onClick, isLoading, icon: Icon, disabled = false }) => (
    <button onClick={() => onClick(action)} disabled={isLoading || disabled} className="px-3 py-1 text-xs font-medium text-gray-300 bg-gray-700 rounded-md hover:bg-gray-600 disabled:opacity-50 flex items-center gap-1.5">
        {isLoading && <Loader2 className="animate-spin" size={12} />}
        {Icon && !isLoading && <Icon size={12} />}
        {label}
    </button>
);

const SchedulerView = ({ scheduledPosts, projects, setModal, db, userId, handleCreateNewProject }) => {
    const [currentDate, setCurrentDate] = useState(new Date());

    const daysInMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const firstDayOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay();

    const changeMonth = (offset) => {
        setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
    };

    const openDayDetailsModal = (date, postsForDay) => {
        setModal({
            isOpen: true,
            content: <DayDetailsModal 
                date={date}
                postsForDay={postsForDay}
                projects={projects}
                onClose={() => setModal({ isOpen: false, content: null })}
                db={db}
                userId={userId}
                handleCreateNewProject={handleCreateNewProject}
                setModal={setModal}
            />
        });
    };

    const calendarDays = [];
    const firstDay = firstDayOfMonth(currentDate);
    const totalDays = daysInMonth(currentDate);
    const today = new Date();

    for (let i = 0; i < firstDay; i++) {
        calendarDays.push(<div key={`empty-${i}`} className="border border-[#D4AF37]/20 rounded-lg"></div>);
    }

    for (let day = 1; day <= totalDays; day++) {
        const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
        const isToday = day === today.getDate() && currentDate.getMonth() === today.getMonth() && currentDate.getFullYear() === today.getFullYear();
        const postsForDay = scheduledPosts.filter(p => {
            const postDate = p.scheduleDate.toDate();
            return postDate.getDate() === day && postDate.getMonth() === currentDate.getMonth() && postDate.getFullYear() === today.getFullYear();
        });

        calendarDays.push(
            <div 
                key={day} 
                onClick={() => openDayDetailsModal(date, postsForDay)} // Pass postsForDay here
                className={`border rounded-lg p-2 flex flex-col hover:bg-[#002244]/50 cursor-pointer transition-colors ${isToday ? 'bg-[#D4AF37]/20 border-[#D4AF37]/50' : 'border-[#D4AF37]/20'}`}
            >
                <span className={`font-bold ${isToday ? 'text-[#D4AF37]' : ''}`}>{day}</span>
                <div className="mt-1 space-y-1 overflow-y-auto">
                    {postsForDay.map(post => (
                        <div key={post.id} className="text-xs bg-[#800020]/50 p-1 rounded">
                            <p className="font-semibold truncate">{post.projectTitle}</p>
                            <p className="text-gray-400">{post.platform}</p>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="animate-fade-in">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-white">Content Scheduler</h1>
                <div className="flex items-center gap-4">
                    <button onClick={() => changeMonth(-1)} className="p-2 rounded-full hover:bg-[#002244]/50"><ChevronLeft/></button>
                    <h2 className="text-xl font-semibold w-48 text-center">{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
                    <button onClick={() => changeMonth(1)} className="p-2 rounded-full hover:bg-[#002244]/50"><ChevronRight/></button>
                </div>
            </div>
            <div className="grid grid-cols-7 gap-2 text-center text-xs font-bold text-gray-400 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day}>{day}</div>)}
            </div>
            <div className="grid grid-cols-7 grid-rows-5 gap-2 h-[70vh]">
                {calendarDays}
            </div>
        </div>
    );
};

// --- Day Details Modal (New Component) ---
const DayDetailsModal = ({ date, postsForDay, projects, onClose, db, userId, handleCreateNewProject, setModal }) => {
    const formattedDate = date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const openScheduleNewPostModal = () => {
        setModal({
            isOpen: true,
            content: <SchedulePostModal 
                date={date}
                projects={projects}
                onClose={() => setModal({ isOpen: false, content: null })}
                db={db}
                userId={userId}
                handleCreateNewProject={handleCreateNewProject}
                setModal={setModal}
            />
        });
    };

    const openEditScheduledPostModal = (post) => {
        setModal({
            isOpen: true,
            content: <EditScheduledPostModal 
                post={post}
                projects={projects}
                onClose={() => setModal({ isOpen: false, content: null })}
                db={db}
                userId={userId}
                setModal={setModal}
            />
        });
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">Scheduled Content for {formattedDate}</h3>
                        <p className="text-gray-400 text-sm">Manage posts for this day.</p>
                    </div>
                    <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>

                <div className="space-y-4">
                    <button 
                        onClick={openScheduleNewPostModal} 
                        className="w-full px-4 py-2 font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 flex items-center justify-center gap-2 mb-4"
                    >
                        <PlusCircle size={20} />
                        <span>Schedule New Post</span>
                    </button>

                    {postsForDay.length === 0 ? (
                        <div className="text-center py-8 bg-[#002244]/50 rounded-lg border border-[#D4AF37]/20 border-dashed">
                            <p className="text-gray-400">No posts scheduled for this day.</p>
                        </div>
                    ) : (
                        <div className="bg-[#002244]/50 rounded-lg border border-[#D4AF37]/20">
                            <ul className="divide-y divide-[#D4AF37]/20">
                                {postsForDay.map(post => (
                                    <li key={post.id} className="p-4 flex justify-between items-center">
                                        <div>
                                            <p className="font-semibold text-[#D4AF37]">{post.projectTitle}</p>
                                            <p className="text-sm text-gray-400">
                                                {post.platform} at {new Date(post.scheduleDate.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </p>
                                        </div>
                                        <button 
                                            onClick={() => openEditScheduledPostModal(post)} 
                                            className="px-3 py-1 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                                        >
                                            Edit
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
};

// --- Edit Scheduled Post Modal (New Component) ---
const EditScheduledPostModal = ({ post, projects, onClose, db, userId, setModal }) => {
    const [editedPlatform, setEditedPlatform] = useState(post.platform);
    const [editedTime, setEditedTime] = useState(new Date(post.scheduleDate.toDate()).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
    const [editedProjectId, setEditedProjectId] = useState(post.projectId);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleUpdate = async (e) => {
        e.preventDefault();
        if (!editedProjectId || !db || !userId) return;

        setIsSaving(true);
        const [hours, minutes] = editedTime.split(':');
        const newScheduleDate = new Date(post.scheduleDate.toDate()); // Keep original date
        newScheduleDate.setHours(parseInt(hours), parseInt(minutes));

        const selectedProject = projects.find(p => p.id === editedProjectId);

        try {
            const docRef = doc(db, `artifacts/${appId}/users/${userId}/scheduledPosts`, post.id);
            await updateDoc(docRef, {
                projectId: editedProjectId,
                projectTitle: selectedProject.title,
                platform: editedPlatform,
                scheduleDate: Timestamp.fromDate(newScheduleDate),
            });
            onClose();
        } catch (error) {
            console.error("Error updating scheduled post:", error);
            setModal({ isOpen: true, content: <AlertModal title="Error" message={`Failed to update post: ${error.message}`} onClose={() => setModal({ isOpen: false, content: null })} /> });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        setModal({
            isOpen: true,
            content: (
                <ConfirmationModal
                    title="Confirm Deletion"
                    message="Are you sure you want to delete this scheduled post? This action cannot be undone."
                    onConfirm={async () => {
                        if (!db || !userId) return;
                        setIsDeleting(true);
                        try {
                            await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/scheduledPosts`, post.id));
                            setModal({ isOpen: false, content: null }); // Close confirmation modal
                            onClose(); // Close edit modal
                        } catch (error) {
                            console.error("Error deleting scheduled post:", error);
                            setModal({ isOpen: true, content: <AlertModal title="Error" message={`Failed to delete post: ${error.message}`} onClose={() => setModal({ isOpen: false, content: null })} /> });
                        } finally {
                            setIsDeleting(false);
                        }
                    }}
                    onCancel={() => setModal({ isOpen: false, content: null })}
                />
            )
        });
    };

    return (
        <Modal onClose={onClose}>
            <form onSubmit={handleUpdate} className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">Edit Scheduled Post</h3>
                        <p className="text-gray-400 text-sm">Editing: {post.projectTitle} on {new Date(post.scheduleDate.toDate()).toLocaleDateString()}</p>
                    </div>
                    <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-gray-300 mb-1 block">Content to Post</label>
                        <select value={editedProjectId} onChange={e => setEditedProjectId(e.target.value)} required className="w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]">
                            {projects.map(p => <option key={p.id} value={p.id}>{p.title} ({p.type})</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-300 mb-1 block">Platform</label>
                        <select value={editedPlatform} onChange={e => setEditedPlatform(e.target.value)} required className="w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]">
                            <option>Twitter</option>
                            <option>Facebook</option>
                            <option>Instagram</option>
                            <option>LinkedIn</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-300 mb-1 block">Time</label>
                        <input type="time" value={editedTime} onChange={e => setEditedTime(e.target.value)} required className="w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]" />
                    </div>
                </div>
                <div className="flex justify-between gap-3 mt-6">
                    <button type="button" onClick={handleDelete} disabled={isDeleting} className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2">
                        {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 size={16} />}
                        <span>{isDeleting ? 'Deleting...' : 'Delete Post'}</span>
                    </button>
                    <div className="flex gap-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-300 bg-gray-700 rounded-lg hover:bg-gray-600">Cancel</button>
                        <button type="submit" disabled={isSaving} className="px-4 py-2 text-sm font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 disabled:opacity-50 flex items-center justify-center gap-2">
                            {isSaving ? <Loader2 className="animate-spin" /> : <Save size={16} />}
                            <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
                        </button>
                    </div>
                </div>
            </form>
        </Modal>
    );
};


// --- Modal Components ---
const Modal = ({ children, onClose }) => (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center animate-fade-in-fast" onClick={onClose}>
        <div className="bg-[#002244] rounded-xl shadow-2xl border border-[#D4AF37]/30 w-full max-w-lg m-4" onClick={e => e.stopPropagation()}>
            {children}
        </div>
    </div>
);

const ConfirmationModal = ({ title, message, onConfirm, onCancel }) => (
    <Modal onClose={onCancel}>
        <div className="p-6">
            <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
            <p className="text-gray-300 mb-6">{message}</p>
            <div className="flex justify-end gap-3">
                <button onClick={onCancel} className="px-4 py-2 text-sm font-semibold text-gray-300 bg-gray-700 rounded-lg hover:bg-gray-600">Cancel</button>
                <button onClick={onConfirm} className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700">Confirm</button>
            </div>
        </div>
    </Modal>
);

const AlertModal = ({ title, message, onClose }) => (
    <Modal onClose={onClose}>
        <div className="p-6">
            <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
            <p className="text-gray-300 mb-6">{message}</p>
            <div className="flex justify-end">
                <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80">OK</button>
            </div>
        </div>
    </Modal>
);

const PatristicInsightModal = ({ insight, onClose }) => (
    <Modal onClose={onClose}>
        <div className="p-6">
            <div className="flex items-start justify-between mb-4">
                <div>
                    <h3 className="text-lg font-bold text-white mb-1">✨ Patristic Insight</h3>
                    <p className="text-gray-400 text-sm">A brief reflection from the Church Fathers.</p>
                </div>
                <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20} /></button>
            </div>
            <div className="prose prose-invert prose-sm max-w-none text-gray-300 overflow-y-auto max-h-80">
                <div dangerouslySetInnerHTML={{ __html: marked.parse(insight) }} />
            </div>
            <div className="flex justify-end mt-4">
                <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80">Close</button>
            </div>
        </div>
    </Modal>
);

const TTSPlayerModal = ({ textToSpeak, onClose }) => {
    const audioRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [voice, setVoice] = useState('Kore');
    const [isReplaying, setIsReplaying] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);

    const voices = [
        "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
        "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
        "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
        "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
        "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"
    ];

    const generateAndPlayAudio = async (text) => {
        if (!text) return;
        setIsGenerating(true);
        try {
            const audioUrl = await callGeminiTTS(text, voice);
            const audio = audioRef.current;
            audio.src = audioUrl;
            audio.load();
            audio.play();
        } catch (error) {
            console.error("TTS generation error:", error);
            // Optionally, show an alert
        } finally {
            setIsGenerating(false);
        }
    };
    
    useEffect(() => {
        const audio = audioRef.current;
        if (audio) {
            const onPlay = () => setIsPlaying(true);
            const onPause = () => setIsPlaying(false);
            const onTimeUpdate = () => setCurrentTime(audio.currentTime);
            const onLoadedMetadata = () => setDuration(audio.duration);
            const onEnded = () => {
                setIsPlaying(false);
                setCurrentTime(0);
            };

            audio.addEventListener('play', onPlay);
            audio.addEventListener('pause', onPause);
            audio.addEventListener('timeupdate', onTimeUpdate);
            audio.addEventListener('loadedmetadata', onLoadedMetadata);
            audio.addEventListener('ended', onEnded);

            return () => {
                audio.removeEventListener('play', onPlay);
                audio.removeEventListener('pause', onPause);
                audio.removeEventListener('timeupdate', onTimeUpdate);
                audio.removeEventListener('loadedmetadata', onLoadedMetadata);
                audio.removeEventListener('ended', onEnded);
            };
        }
    }, []);

    // Initial fetch of audio on mount
    useEffect(() => {
        generateAndPlayAudio(textToSpeak);
    }, [textToSpeak, voice]);

    const handlePlayPause = () => {
        const audio = audioRef.current;
        if (audio) {
            if (isPlaying) {
                audio.pause();
            } else {
                audio.play();
            }
        }
    };

    const handleSeek = (e) => {
        const audio = audioRef.current;
        if (audio) {
            audio.currentTime = e.target.value;
            setCurrentTime(audio.currentTime);
        }
    };

    const formatTime = (time) => {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    };

    const handleReplay = () => {
        generateAndPlayAudio(textToSpeak);
    };
    
    const handleVoiceChange = (e) => {
        setVoice(e.target.value);
    };

    const handleClose = () => {
        const audio = audioRef.current;
        if(audio) audio.pause();
        onClose();
    };

    return (
        <Modal onClose={handleClose}>
            <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">Text-to-Speech Player</h3>
                        <p className="text-gray-400 text-sm">Listen to your content with a chosen voice.</p>
                    </div>
                    <button onClick={handleClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20} /></button>
                </div>
                
                {isGenerating ? (
                    <LoadingSpinner message="Generating audio..." />
                ) : (
                    <>
                        <audio ref={audioRef} className="w-full hidden" />
                        <div className="flex items-center gap-4 mt-4">
                            <button onClick={handlePlayPause} className="p-3 bg-[#D4AF37] rounded-full text-black hover:bg-yellow-300 transition-colors">
                                {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                            </button>
                            <div className="flex-grow">
                                <input
                                    type="range"
                                    min="0"
                                    max={duration || 0}
                                    value={currentTime}
                                    onChange={handleSeek}
                                    className="w-full"
                                />
                                <div className="flex justify-between text-xs text-gray-400">
                                    <span>{formatTime(currentTime)}</span>
                                    <span>{formatTime(duration)}</span>
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 flex flex-col gap-2">
                            <label className="block text-sm font-medium text-gray-300">Voice</label>
                            <div className="flex items-center gap-2">
                                <select 
                                    value={voice} 
                                    onChange={handleVoiceChange}
                                    className="flex-grow bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                                >
                                    {voices.map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                                <button onClick={handleReplay} disabled={isReplaying} className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50">
                                    {isReplaying ? <Loader2 className="animate-spin" /> : <RefreshCw size={16} />}
                                    <span>Replay</span>
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
};

// FormattedContentModal definition moved here
const FormattedContentModal = ({ title, content, onClose }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        const textArea = document.createElement("textarea");
        textArea.value = content;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Fallback: Oops, unable to copy', err);
        }
        document.body.removeChild(textArea);
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">{title}</h3>
                        <p className="text-gray-400 text-sm">Review and copy the formatted content below.</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                <textarea
                    readOnly
                    value={content}
                    className="w-full h-64 p-3 bg-[#003366]/50 text-gray-300 rounded-lg border border-[#D4AF37]/30 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] resize-y leading-relaxed"
                />
                <div className="flex justify-end gap-3 mt-4">
                    <button onClick={handleCopy} className="px-4 py-2 text-sm font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 flex items-center gap-2">
                        {copied ? <CheckCircle size={16} /> : <ClipboardCopy size={16} />}
                        <span>{copied ? 'Copied!' : 'Copy to Clipboard'}</span>
                    </button>
                </div>
            </div>
        </Modal>
    );
};


const LoadingSpinner = ({ message }) => (
    <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
        <Loader2 size={48} className="animate-spin text-[#D4AF37]" />
        <p className="text-gray-300">{message}</p>
    </div>
);

const ComingSoonView = ({ featureName }) => (
    <div className="flex flex-col items-center justify-center h-full text-center animate-fade-in">
        <h1 className="text-4xl font-bold text-white mb-4">{featureName}</h1>
        <p className="text-gray-400 text-lg mb-8">This feature is currently in development.</p>
        <div className="p-8 bg-[#002244]/50 rounded-lg border border-[#D4AF37]/20">
            <p className="text-[#D4AF37]">We're working hard to bring you powerful tools for creating {featureName.toLowerCase()}. Stay tuned!</p>
        </div>
    </div>
);

const GeneratedImageVariationsModal = ({ imageUrls, prompt, onClose, error, onGenerateMore, setModal }) => {
    const [currentImageIndex, setCurrentImageIndex] = useState(0);

    // Ensure imageUrls is always an array, even if a single imageUrl is passed
    const imagesToDisplay = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []);

    const handleDownloadImage = () => {
        if (!imagesToDisplay.length) return;
        const link = document.createElement('a');
        link.href = imagesToDisplay[currentImageIndex];
        link.download = `atmt-image-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setModal({ isOpen: true, content: <AlertModal title="Download Started" message="Your image download should begin shortly." onClose={() => setModal({isOpen: false, content: null})} /> });
    };

    const placeholderUrl = `https://placehold.co/512x512/334155/94a3b8?text=Image+Generation+Failed`;

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">{error ? 'Image Generation Failed' : 'Generated Image(s)'}</h3>
                        <p className="text-gray-400 text-sm max-w-md">Prompt: "{prompt}"</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                
                <div className="bg-[#003366]/50 p-4 rounded-lg flex justify-center items-center relative min-h-[250px]">
                    {error ? (
                        <div className="text-center">
                            <img src={placeholderUrl} alt="Image generation failed" className="rounded-lg mx-auto mb-4" />
                            <p className="text-red-400 text-sm font-semibold">Error Details:</p>
                            <p className="text-gray-400 text-xs mt-1">{error}</p>
                        </div>
                    ) : (
                        <>
                            {imagesToDisplay.length > 0 && (
                                <img src={imagesToDisplay[currentImageIndex]} alt={prompt} className="rounded-lg max-w-full max-h-[60vh] object-contain" />
                            )}
                            {imagesToDisplay.length > 1 && (
                                <>
                                    <button
                                        onClick={() => setCurrentImageIndex(prev => (prev - 1 + imagesToDisplay.length) % imagesToDisplay.length)}
                                        className="absolute left-2 top-1/2 transform -translate-y-1/2 p-2 rounded-full bg-black/30 hover:bg-black/50 text-white"
                                    >
                                        <ChevronLeft size={24} />
                                    </button>
                                    <button
                                        onClick={() => setCurrentImageIndex(prev => (prev + 1) % imagesToDisplay.length)}
                                        className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 rounded-full bg-black/30 hover:bg-black/50 text-white"
                                    >
                                        <ChevronRight size={24} />
                                    </button>
                                    <div className="absolute bottom-2 text-xs text-gray-300">
                                        {currentImageIndex + 1} / {imagesToDisplay.length}
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>

                {!error && (
                    <div className="flex justify-between items-center mt-6">
                        {onGenerateMore && (
                            <button onClick={onGenerateMore} className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-2">
                                <RefreshCw size={16} /> Generate More Variations
                            </button>
                        )}
                        <div className="flex gap-3 ml-auto">
                            <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-300 bg-gray-700 rounded-lg hover:bg-gray-600">Close</button>
                            <button onClick={handleDownloadImage} className="px-4 py-2 text-sm font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 flex items-center gap-2">
                                <Download size={16} />
                                <span>Download Image</span>
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
};
const PatristicExegesisModal = ({ onClose, onCreateProject, setModal }) => {
    const [verseInput, setVerseInput] = useState('');
    const [generatedExegesis, setGeneratedExegesis] = useState('');
    const [generatedHomilyIdeas, setGeneratedHomilyIdeas] = useState([]);
    const [fullGeneratedContent, setFullGeneratedContent] = useState('');
    const [fullContentType, setFullContentType] = useState(''); // 'commentary', 'homily', 'essay'
    const [selectedHomilyTitle, setSelectedHomilyTitle] = useState(''); // New state for selected title
    const [isLoading, setIsLoading] = useState(false);
    const [stage, setStage] = useState('input_verse'); // 'input_verse', 'exegesis_results', 'full_content_display'
    const [copiedContent, setCopiedContent] = useState(false);
    const [recommendedBooks, setRecommendedBooks] = useState([]); // New state for books
    const [isLoadingBooks, setIsLoadingBooks] = useState(false); // New state for loading books

    const handleGenerateExegesis = async () => {
        if (!verseInput) return;
        setIsLoading(true);
        setGeneratedExegesis('');
        setGeneratedHomilyIdeas([]);
        setFullGeneratedContent('');
        setFullContentType('');
        setSelectedHomilyTitle(''); // Reset selected title
        setRecommendedBooks([]);
        setIsLoadingBooks(false);

        const prompt = `Act as a scholar of Patristics and Orthodox theology. Provide an exegesis of the following Bible passage or theological topic: "${verseInput}". Explain its meaning and then provide insights and relevant quotes from the Church Fathers (e.g., St. John Chrysostom, St. Athanasius, St. Cyril of Alexandria, St. Basil the Great, St. Gregory of Nyssa, St. Gregory the Theologian, St. Ephrem the Syrian, St. Isaac the Syrian, St. Severus of Antioch, St. Dioscorus of Alexandria) that illuminate the passage from an Orthodox perspective. Then, based on your exegesis, brainstorm 3-4 thematic homily titles. For each title, list the key Church Father(s) whose work is most relevant. The response must be in JSON format.`;
        const schema = {
            type: "OBJECT",
            properties: {
                exegesis: { type: "STRING" },
                homilyIdeas: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            title: { type: "STRING" },
                            fathers: { type: "STRING" }
                        },
                        required: ["title", "fathers"]
                    }
                }
            },
            required: ["exegesis", "homilyIdeas"]
        };
        
        try {
            const result = await callGemini(prompt, schema);
            const parsed = JSON.parse(result);
            setGeneratedExegesis(parsed.exegesis || "No exegesis generated.");
            setGeneratedHomilyIdeas(parsed.homilyIdeas || []);
            setStage('exegesis_results');
            console.log("Debugging: Initial exegesis generated and parsed:", parsed); // Debugging
        } catch (error) {
            console.error("Exegesis generation error:", error);
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to generate exegesis: ${error.message}`} onClose={() => {
                setModal({ isOpen: false, content: null });
                onClose();
            }} /> });
            setGeneratedExegesis("Sorry, an error occurred. Please check the console for details and try again.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleGenerateFullContent = async (type, titleFromHomilyIdea = '') => {
        setIsLoading(true);
        setFullGeneratedContent('');
        setRecommendedBooks([]);
        setIsLoadingBooks(false);
        setFullContentType(type);
        setSelectedHomilyTitle(titleFromHomilyIdea); // Set the selected title

        let prompt;
        const baseContent = `Bible passage/topic: "${verseInput}"\n\nInitial Exegesis:\n${generatedExegesis}`;
        const specificTitle = titleFromHomilyIdea ? `Title: "${titleFromHomilyIdea}"\n\n` : '';

        switch (type) {
            case 'extended-commentary':
                prompt = `You are a scholar of Patristics and Orthodox theology. Based on the following information, write a detailed extended patristic commentary. Focus on deep theological exploration, extensive patristic and scriptural references, and maintain a scholarly yet accessible tone for the ATMT audience (Grade 6-8 readability). Structure it with an introduction, several thematic sections, and a conclusion. Provide the output in markdown.\n\n${specificTitle}${baseContent}`;
                break;
            case 'full-homily':
                prompt = `You are a homilist for "Ancient Truths, Modern Times." Based on the following information, write a full, ready-to-preach homily manuscript. Maintain a pastoral, reverent, and clear tone suitable for oral delivery to the ATMT audience. Incorporate scriptural exegesis, patristic wisdom, and practical application. Structure it with a clear title, introduction, main points, and conclusion. Provide the output in markdown.\n\n${specificTitle}${baseContent}`;
                break;
            case 'theological-essay':
                prompt = `You are an academic theologian writing for "Ancient Truths, Modern Times." Based on the following information, write a comprehensive theological essay. This essay should provide a structured, argumentative, and in-depth academic treatment of the theological implications. Include a clear thesis, well-reasoned arguments supported by scripture and patristic sources, and a strong conclusion. Maintain a scholarly yet accessible tone for the ATMT audience (Grade 6-8 readability). Provide the output in markdown.\n\n${specificTitle}${baseContent}`;
                break;
            default:
                setIsLoading(false);
                return;
        }

        try {
            const result = await callGemini(prompt);
            setFullGeneratedContent(result);
            setStage('full_content_display');
            console.log("Debugging: Full content generated:", result); // Debugging
            // Fetch book recommendations after content is generated
            setIsLoadingBooks(true);
            const books = await getRecommendedBooks(titleFromHomilyIdea + "\n\n" + result);
            setRecommendedBooks(books);
        } catch (error) {
            console.error(`Full content generation error for ${type}:`, error);
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to generate full content: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
        } finally {
            setIsLoading(false);
            setIsLoadingBooks(false);
        }
    };

    const handleInsertIntoEditor = async () => {
        console.log("Debugging: Attempting to insert into editor. Content length:", fullGeneratedContent?.length); // Debugging
        if (!fullGeneratedContent) {
            setModal({ isOpen: true, content: <AlertModal title="Error" message="No content to insert into editor." onClose={() => setModal({isOpen: false, content: null})} /> });
            return;
        }
        let projectType = 'blog'; // Default type
        let projectTitle = selectedHomilyTitle || `${verseInput} - ${fullContentType.replace('-', ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}`;

        if (fullContentType === 'full-homily') {
            projectType = 'sermon';
            projectTitle = selectedHomilyTitle || `Homily on ${verseInput}`;
        } else if (fullContentType === 'theological-essay') {
            projectType = 'ebooks'; 
            projectTitle = selectedHomilyTitle || `Essay on ${verseInput}`;
        } else if (fullContentType === 'extended-commentary') {
            projectType = 'blog';
            projectTitle = selectedHomilyTitle || `Commentary on ${verseInput}`;
        }
        
        try {
            const newProject = await onCreateProject(projectType, projectTitle, fullGeneratedContent);
            console.log("Debugging: New project created:", newProject); // Debugging
            onClose();
        } catch (error) {
            console.error("Error inserting into editor:", error); // Debugging
            setModal({ isOpen: true, content: <AlertModal title="Error" message={`Failed to insert into editor: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
        }
    };

    const handleCopyFullContent = () => {
        console.log("Debugging: Attempting to copy content. Content length:", fullGeneratedContent?.length); // Debugging
        if (!fullGeneratedContent) {
            setModal({ isOpen: true, content: <AlertModal title="Copy Failed" message="No content to copy." onClose={() => setModal({isOpen: false, content: null})} /> });
            return;
        }
        const textArea = document.createElement("textarea");
        textArea.value = fullGeneratedContent;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                setCopiedContent(true);
                setTimeout(() => setCopiedContent(false), 2000);
                console.log("Debugging: Content copied successfully."); // Debugging
            } else {
                console.error('Debugging: document.execCommand("copy") failed.'); // Debugging
                setModal({ isOpen: true, content: <AlertModal title="Copy Failed" message="Could not copy content. Please try manually." onClose={() => setModal({isOpen: false, content: null})} /> });
            }
        } catch (err) {
            console.error('Debugging: Fallback: Oops, unable to copy', err); // Existing error log
            setModal({ isOpen: true, content: <AlertModal title="Copy Failed" message="Could not copy content. Please try manually." onClose={() => setModal({isOpen: false, content: null})} /> });
        }
        document.body.removeChild(textArea);
    };

    const handleBackToExegesis = () => {
        setFullGeneratedContent('');
        setFullContentType('');
        setRecommendedBooks([]);
        setIsLoadingBooks(false);
        setStage('exegesis_results');
    };

    const handleStartOver = () => {
        setVerseInput('');
        setGeneratedExegesis('');
        setGeneratedHomilyIdeas([]);
        setFullGeneratedContent('');
        setFullContentType('');
        setSelectedHomilyTitle('');
        setRecommendedBooks([]);
        setIsLoadingBooks(false);
        setStage('input_verse');
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6 h-full flex flex-col">
                <div className="flex items-start justify-between mb-4 flex-shrink-0">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">✨ Patristic Exegesis Builder</h3>
                        <p className="text-gray-400 text-sm">Craft deep theological content from scripture and the Church Fathers.</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366)/50"><X size={20}/></button>
                </div>

                {stage === 'input_verse' && (
                    <div className="animate-fade-in flex flex-col flex-grow">
                        <p className="text-gray-300 mt-1 mb-4">Enter a Bible verse (e.g., John 1:1-5) or a theological topic (e.g., Theosis) to begin.</p>
                        <div className="flex items-center gap-2 mb-4">
                            <input
                                type="text"
                                value={verseInput}
                                onChange={e => setVerseInput(e.target.value)}
                                placeholder="Enter verse or topic"
                                className="flex-grow w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                            />
                            <button onClick={handleGenerateExegesis} disabled={isLoading || !verseInput} className="px-6 py-2 font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 disabled:opacity-50 flex items-center justify-center gap-2">
                                <BookOpen />
                                <span>{isLoading ? 'Generating...' : 'Generate Insights'}</span>
                            </button>
                        </div>
                        {isLoading && <LoadingSpinner message="Generating initial exegesis..." />}
                    </div>
                )}

                {stage === 'exegesis_results' && (
                    <div className="animate-fade-in flex flex-col flex-grow">
                        <div className="text-right mb-4">
                            <button onClick={handleStartOver} className="text-sm text-[#D4AF37] hover:text-yellow-200">&larr; Start Over</button>
                        </div>
                        <div className="flex-grow min-h-[200px] max-h-80 overflow-y-auto bg-[#003366]/50 p-4 rounded-lg border border-[#D4AF37]/20">
                            <h4 className="font-semibold text-[#D4AF37] mb-2">Exegesis for "{verseInput}":</h4>
                            <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap text-gray-300" dangerouslySetInnerHTML={{ __html: generatedExegesis.replace(/\n/g, '<br />') }} />
                            {generatedHomilyIdeas.length > 0 && (
                                <div className="mt-4 pt-4 border-t border-[#D4AF37]/20">
                                    <h4 className="font-semibold text-[#D4AF37] mb-2">Suggested Homily Titles:</h4>
                                    <ul className="space-y-2">
                                        {generatedHomilyIdeas.map((idea, index) => (
                                            <li key={index} className="flex justify-between items-center p-2 bg-[#003366]/50 rounded-lg">
                                                <div>
                                                    <p className="text-gray-300">{idea.title}</p>
                                                    <p className="text-xs text-gray-400">Key Fathers: {idea.fathers}</p>
                                                </div>
                                                <button onClick={() => setSelectedHomilyTitle(idea.title)} className="text-xs font-semibold text-[#D4AF37] hover:text-yellow-200 flex-shrink-0 ml-4">
                                                    Use this Title
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col gap-3">
                            <p className="font-semibold text-white">Develop Full Content:</p>
                            {selectedHomilyTitle && (
                                <p className="text-sm text-yellow-200">Selected Title: "{selectedHomilyTitle}"</p>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <button onClick={() => handleGenerateFullContent('extended-commentary', selectedHomilyTitle)} disabled={isLoading} className="p-3 font-semibold text-white bg-blue-600/80 rounded-lg hover:bg-blue-600 disabled:bg-gray-600 flex items-center justify-center gap-2">
                                    {isLoading ? <Loader2 className="animate-spin" /> : <BookOpen />}
                                    <span>Extended Commentary</span>
                                </button>
                                <button onClick={() => handleGenerateFullContent('full-homily', selectedHomilyTitle)} disabled={isLoading} className="p-3 font-semibold text-white bg-green-600/80 rounded-lg hover:bg-green-600 disabled:bg-gray-600 flex items-center justify-center gap-2">
                                    {isLoading ? <Loader2 className="animate-spin" /> : <Megaphone />}
                                    <span>Full Homily</span>
                                </button>
                                <button onClick={() => handleGenerateFullContent('theological-essay', selectedHomilyTitle)} disabled={isLoading} className="p-3 font-semibold text-white bg-purple-600/80 rounded-lg hover:bg-purple-600 disabled:bg-gray-600 flex items-center justify-center gap-2">
                                    {isLoading ? <Loader2 className="animate-spin" /> : <GraduationCap />}
                                    <span>Theological Essay</span>
                                </button>
                            </div>
                        </div>
                        {isLoading && <LoadingSpinner message="Generating full content..." />}
                    </div>
                )}

                {stage === 'full_content_display' && (
                    <div className="animate-fade-in flex flex-col flex-grow">
                            <div className="text-right mb-4">
                                <button onClick={handleBackToExegesis} className="text-sm text-[#D4AF37] hover:text-yellow-200">&larr; Back to Exegesis</button>
                            </div>
                            <div className="flex-grow min-h-[200px] max-h-80 overflow-y-auto bg-[#003366]/50 p-4 rounded-lg border border-[#D4AF37]/20">
                                <h4 className="font-semibold text-[#D4AF37] mb-2">{fullContentType.replace('-', ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')} on "{verseInput}":</h4>
                                <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap text-gray-300" dangerouslySetInnerHTML={{ __html: marked.parse(fullGeneratedContent) }} />
                            </div>
                            {isLoadingBooks && <div className="mt-4"><LoadingSpinner message="Finding book recommendations..." /></div>}
                            {!isLoadingBooks && recommendedBooks && recommendedBooks.length > 0 && (
                                <div className="mt-4 pt-4 border-t border-[#D4AF37]/20">
                                    <h4 className="font-semibold text-[#D4AF37] mb-2 flex items-center gap-2"><Book size={16}/> Recommended Books</h4>
                                    <ul className="list-disc list-inside text-sm text-gray-400 space-y-1">
                                        {recommendedBooks.map((book, index) => (
                                            <li key={index}>"{book.title}" by {book.author}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <div className="mt-4 flex justify-end gap-3">
                                <button onClick={handleCopyFullContent} className="px-4 py-2 text-sm font-semibold text-gray-300 bg-gray-700 rounded-lg hover:bg-gray-600 flex items-center gap-2">
                                    {copiedContent ? <CheckCircle size={16} /> : <ClipboardCopy size={16} />} Copy
                                </button>
                                <button onClick={handleInsertIntoEditor} className="px-4 py-2 text-sm font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 flex items-center gap-2">
                                    <Save size={16} /> Insert into Editor
                                </button>
                            </div>
                    </div>
                )}
            </div>
        </Modal>
    );
};

// --- NEW SERMON COACH MODAL ---
const SermonCoachModal = ({ sermonTitle, sermonContent, onClose, setModal, onCreateProject }) => {
    const [feedback, setFeedback] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [feedbackTitle, setFeedbackTitle] = useState('');

    const handleCoach = async (type) => {
        setIsLoading(true);
        setFeedback('');
        let prompt;
        switch (type) {
            case 'theology':
                setFeedbackTitle('Theological Accuracy Review');
                prompt = `You are a theological reviewer specializing in Ethiopian Orthodox Tewahedo doctrine. Review the following sermon titled "${sermonTitle}". Check for theological accuracy, consistency with patristic teachings, and appropriate use of scripture. Provide constructive feedback in markdown format, highlighting strengths and areas for refinement. \n\nSermon Content:\n${sermonContent}`;
                break;
            case 'clarity':
                setFeedbackTitle('Clarity & Flow Analysis');
                prompt = `You are a writing and public speaking coach. Analyze the following sermon titled "${sermonTitle}". Check for clarity, logical flow, and structure. Is the main point clear? Does it progress logically? Is the language accessible? Provide actionable suggestions for improvement in markdown format. \n\nSermon Content:\n${sermonContent}`;
                break;
            case 'engagement':
                setFeedbackTitle('Audience Engagement Suggestions');
                prompt = `You are a communications expert. Review the sermon titled "${sermonTitle}". Suggest ways to make it more engaging for a modern audience. Suggest adding rhetorical questions, illustrative stories, or modern-day parallels that connect with the theme, without compromising the reverent tone. Provide your suggestions as a list in markdown format. \n\nSermon Content:\n${sermonContent}`;
                break;
            case 'delivery':
                setFeedbackTitle('Delivery & Presentation Tips');
                prompt = `You are a public speaking coach. Based on the text of the sermon titled "${sermonTitle}", provide practical delivery tips. Suggest where to pause for effect, which phrases to emphasize, and general advice on tone, pacing, and body language to effectively convey the message. Format the tips as a list in markdown. \n\nSermon Content:\n${sermonContent}`;
                break;
            default:
                setIsLoading(false);
                return;
        }

        try {
            const result = await callGemini(prompt);
            setFeedback(result);
        } catch (error) {
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to get coaching feedback: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveFeedback = async () => {
        if (!feedback) return;
        const newTitle = `Coaching for: ${sermonTitle}`;
        const newContent = `## ${feedbackTitle}\n\n${feedback}`;
        await onCreateProject('devotional', newTitle, newContent); // Saving as a 'devotional' type for easy viewing
        onClose();
    };

    const coachingOptions = [
        { id: 'theology', label: 'Theological Accuracy', icon: BookCheck },
        { id: 'clarity', label: 'Clarity & Flow', icon: Waves },
        { id: 'id:engagement', label: 'Audience Engagement', icon: Target },
        { id: 'delivery', label: 'Delivery Tips', icon: Zap },
    ];

    return (
        <Modal onClose={onClose}>
            <div className="p-6 max-h-[90vh] flex flex-col">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">✨ AI Sermon Coach</h3>
                        <p className="text-gray-400 text-sm">Get feedback to refine your sermon.</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
                    {coachingOptions.map(opt => (
                        <button key={opt.id} onClick={() => handleCoach(opt.id)} disabled={isLoading} className="p-2 text-sm font-semibold text-white bg-[#003366]/80 rounded-lg hover:bg-[#003366] disabled:opacity-50 flex flex-col items-center justify-center gap-2 h-20">
                            <opt.icon size={24} className="text-[#D4AF37]" />
                            <span>{opt.label}</span>
                        </button>
                    ))}
                </div>

                <div className="flex-grow min-h-[250px] overflow-y-auto bg-[#003366]/50 p-4 rounded-lg border border-[#D4AF37]/20">
                    {isLoading ? <LoadingSpinner message="Your coach is thinking..." /> : (
                        feedback ? (
                            <div>
                                <h4 className="font-bold text-[#D4AF37] mb-2">{feedbackTitle}</h4>
                                <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap text-gray-300" dangerouslySetInnerHTML={{ __html: feedback.replace(/\n/g, '<br />') }}></div>
                            </div>
                        ) : (
                            <p className="text-gray-400 text-center mt-16">Select a coaching category above to get started.</p>
                        )
                    )}
                </div>

                {feedback && !isLoading && (
                    <div className="flex justify-end mt-4">
                        <button onClick={handleSaveFeedback} className="px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 flex items-center gap-2">
                            <Save size={16} /> Save Feedback as Note
                        </button>
                    </div>
                )}
            </div>
        </Modal>
    );
};


// --- OTHER MODALS ---
const SchedulePostModal = ({ date, projects, onClose, db, userId, handleCreateNewProject, setModal }) => {
    const [projectId, setProjectId] = useState('');
    const [platform, setPlatform] = useState('Twitter');
    const [time, setTime] = useState('12:00');
    const [isLoading, setIsLoading] = useState(false);
    const [suggestions, setSuggestions] = useState(null);
    const [isSuggesting, setIsSuggesting] = useState(false);

    const handleGetSuggestions = async () => {
        setIsSuggesting(true);
        const gregorianDateString = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        const projectTitles = projects.map(p => p.title).join(', ');
        const prompt = `For the Gregorian date ${gregorianDateString}, what are the relevant Ethiopian Orthodox Tewahedo feasts, fasts, or saints commemorated? Based on that, suggest one new, short social media post (title and content). Also, analyze this list of existing project titles and recommend up to 2 that are most relevant to the day: [${projectTitles}]. Return a JSON object. If there is no specific commemoration, state that in the liturgicalInfo field.`;
        const schema = { type: "OBJECT", properties: { liturgicalInfo: { type: "STRING" }, suggestedPost: { type: "OBJECT", properties: { title: { type: "STRING" }, content: { type: "STRING" } } }, recommendedTitles: { type: "ARRAY", items: { type: "STRING" } } } };

        try {
            const result = await callGemini(prompt, schema);
            setSuggestions(JSON.parse(result));
        } catch (error) {
            console.error("Suggestion generation error:", error);
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to get suggestions: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
        } finally {
            setIsSuggesting(false);
        }
    };

    const handleUseSuggestion = async (suggestion) => {
        const newProject = await handleCreateNewProject('devotional', suggestion.title, suggestion.content);
        if (newProject && newProject.id) {
            setProjectId(newProject.id);
        }
        setSuggestions(null);
    };
    
    const handleSelectRecommendation = (title) => {
        const recommendedProject = projects.find(p => p.title === title);
        if (recommendedProject) {
            setProjectId(recommendedProject.id);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!projectId || !db || !userId) return;

        setIsLoading(true);
        const [hours, minutes] = time.split(':');
        const scheduleDate = new Date(date);
        scheduleDate.setHours(hours, minutes);

        const selectedProject = projects.find(p => p.id === projectId);

        try {
            const collectionPath = `artifacts/${appId}/users/${userId}/scheduledPosts`;
            await addDoc(collection(db, collectionPath), {
                projectId,
                projectTitle: selectedProject.title,
                platform,
                scheduleDate: Timestamp.fromDate(scheduleDate),
                status: 'scheduled'
            });
            onClose();
        } catch (error) {
            console.error("Error scheduling post:", error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Modal onClose={onClose}>
            <form onSubmit={handleSubmit} className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">Schedule a Post</h3>
                        <p className="text-gray-400 text-sm">Schedule for {date.toLocaleDateString()}</p>
                    </div>
                    <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                <div className="space-y-4">
                    <button type="button" onClick={handleGetSuggestions} disabled={isSuggesting} className="w-full px-4 py-2 font-semibold text-white bg-[#D4AF37]/80 rounded-lg hover:bg-[#D4AF37] flex items-center justify-center gap-2">
                        {isSuggesting ? <Loader2 className="animate-spin" /> : <Lightbulb size={16} />}
                        <span>{isSuggesting ? 'Getting Suggestions...' : '✨ Get AI Suggestions for this date'}</span>
                    </button>

                    {suggestions && (
                        <div className="p-3 bg-[#003366]/50 rounded-lg space-y-3">
                            <p className="text-sm"><span className="font-semibold text-[#D4AF37]">Liturgical Info:</span> {suggestions.liturgicalInfo}</p>
                            {suggestions.suggestedPost && (
                                <div className="p-2 bg-[#002244]/50 rounded">
                                    <p className="font-semibold">New Post Idea:</p>
                                    <p className="text-sm font-bold">{suggestions.suggestedPost.title}</p>
                                    <p className="text-xs text-gray-300 mt-1">{suggestions.suggestedPost.content}</p>
                                    <button type="button" onClick={() => handleUseSuggestion(suggestions.suggestedPost)} className="text-xs font-bold text-green-400 hover:text-green-300 mt-2">Use this post</button>
                                </div>
                            )}
                            {suggestions.recommendedTitles?.length > 0 && (
                                <div className="p-2 bg-[#002244]/50 rounded">
                                    <p className="font-semibold">Recommended from your content:</p>
                                    <ul className="list-disc list-inside mt-1 space-y-1">
                                        {suggestions.recommendedTitles.map(title => (
                                            <li key={title} className="text-sm text-gray-300 cursor-pointer hover:text-[#D4AF37]" onClick={() => handleSelectRecommendation(title)}>
                                                {title}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}

                    <div>
                        <label className="text-sm font-medium text-gray-300 mb-1 block">Content to Post</label>
                        <select value={projectId} onChange={e => setProjectId(e.target.value)} required className="w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]">
                            <option value="">Select content...</option>
                            {projects.map(p => <option key={p.id} value={p.id}>{p.title} ({p.type})</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-300 mb-1 block">Platform</label>
                        <select value={platform} onChange={e => setPlatform(e.target.value)} required className="w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]">
                            <option>Twitter</option>
                            <option>Facebook</option>
                            <option>Instagram</option>
                            <option>LinkedIn</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-300 mb-1 block">Time</label>
                        <input type="time" value={time} onChange={e => setTime(e.target.value)} required className="w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]" />
                    </div>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-300 bg-gray-700 rounded-lg hover:bg-gray-600">Cancel</button>
                    <button type="submit" disabled={isLoading} className="px-4 py-2 text-sm font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 disabled:opacity-50 flex items-center justify-center gap-2">
                        {isLoading ? <Loader2 className="animate-spin" /> : <CalendarIcon size={16} />}
                        <span>{isLoading ? 'Scheduling...' : 'Schedule Post'}</span>
                    </button>
                </div>
            </form>
        </Modal>
    );
};
const IdeaGeneratorModal = ({ onClose, onCreateProject, setModal }) => {
    const categories = useMemo(() => [
        "Faith and Practice", 
        "Sermons and Reflections", 
        "Apologetics and Orthodox Defense",
        "Orthodox Family and Parenting", 
        "Ancient Wisdom for Modern Times",
        "Contemporary Issues through an Orthodox Lens", // New Category
        "Ancient Heresies, Modern Parallels", // New Category
        "Lives of the Saints & Hagiography", // New Category
        "Understanding the Liturgy & Sacraments", // New Category
        "Answering Tough Questions" // New Category
    ], []);
    const [category, setCategory] = useState(categories[0]);
    const [ideas, setIdeas] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const handleGenerate = async () => {
        setIsLoading(true);
        setIdeas([]);
        const prompt = `Brainstorm a list of 5 blog post titles for the category "${category}". The blog is "Ancient Truths, Modern Times," which focuses on making Ethiopian Orthodox Tewahedo theology and spirituality accessible to a modern, English-speaking audience. The tone should be reverent, insightful, and engaging. The response must be in JSON format.`;
        const schema = { type: "OBJECT", properties: { ideas: { type: "ARRAY", items: { type: "STRING" } } } };

        try {
            const result = await callGemini(prompt, schema);
            const parsed = JSON.parse(result);
            setIdeas(parsed.ideas || []);
        } catch (error) {
            console.error("Idea generation error:", error);
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to generate ideas: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
        } finally {
            setIsLoading(false);
        }
    };

    const handleStartWriting = (title) => {
        onCreateProject('blog', title);
        onClose();
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">✨ Blog Idea Generator</h3>
                        <p className="text-gray-400 text-sm">Get inspired with AI-generated blog post titles.</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                <div className="flex items-center gap-2 mb-4">
                    <select value={category} onChange={e => setCategory(e.target.value)} className="flex-grow w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]">
                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button onClick={handleGenerate} disabled={isLoading} className="px-6 py-2 font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 disabled:opacity-50 flex items-center justify-center gap-2">
                        {isLoading ? <Loader2 className="animate-spin" /> : <Lightbulb />}
                        <span>{isLoading ? 'Generating...' : 'Generate'}</span>
                    </button>
                </div>
                <div className="min-h-[200px]">
                    {isLoading ? <LoadingSpinner message="Brainstorming ideas..." /> : (
                        <ul className="space-y-2">
                            {ideas.map((idea, index) => (
                                <li key={index} className="flex justify-between items-center p-3 bg-[#003366]/50 rounded-lg transition-transform duration-200 ease-in-out hover:-translate-y-1 hover:bg-[#003366]">
                                    <span className="text-gray-300">{idea}</span>
                                    <button onClick={() => handleStartWriting(idea)} className="text-xs font-semibold text-[#D4AF37] hover:text-yellow-200">Start Writing</button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </Modal>
    );
};
const SermonIdeaGeneratorModal = ({ onClose, onCreateProject, setModal }) => {
    const categories = useMemo(() => [
        { id: 'lectionary', name: 'Lectionary Reading', placeholder: 'e.g., John 3:16' },
        { id: 'feast', name: 'Upcoming Feast / Fast', placeholder: 'e.g., The Feast of the Holy Cross' },
        { id: 'topic', name: 'Theological Topic', placeholder: 'e.g., The importance of fasting' },
        { id: 'verse', name: 'Bible Verse', placeholder: 'e.g., Psalm 23' },
    ], []);
    const [category, setCategory] = useState(categories[0].id);
    const [input, setInput] = useState('');
    const [ideas, setIdeas] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const handleGenerate = async () => {
        setIsLoading(true);
        setIdeas([]);
        const selectedCategory = categories.find(c => c.id === category);
        const prompt = `Brainstorm a list of 5 sermon or homily titles for an Ethiopian Orthodox Tewahedo audience. The theme is based on the category "${selectedCategory.name}" with the specific input: "${input}". The tone should be pastoral, reverent, and suitable for a sermon. The response must be in JSON format.`;
        const schema = { type: "OBJECT", properties: { ideas: { type: "ARRAY", items: { type: "STRING" } } } };

        try {
            const result = await callGemini(prompt, schema);
            const parsed = JSON.parse(result);
            setIdeas(parsed.ideas || []);
        } catch (error) {
            console.error("Sermon idea generation error:", error);
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to generate sermon ideas: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleStartWriting = (title) => {
        onCreateProject('sermon', title);
        onClose();
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">✨ Sermon & Homily Idea Generator</h3>
                        <p className="text-gray-400 text-sm">Get inspired with AI-generated sermon topics.</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                <div className="flex flex-col md:flex-row items-center gap-2 mb-4">
                    <select value={category} onChange={e => setCategory(e.target.value)} className="w-full md:w-1/3 bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]">
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input type="text" value={input} onChange={e => setInput(e.target.value)} placeholder={categories.find(c => c.id === category)?.placeholder} className="flex-grow w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]" />
                    <button onClick={handleGenerate} disabled={isLoading || !input} className="w-full md:w-auto px-6 py-2 font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 disabled:opacity-50 flex items-center justify-center gap-2">
                        {isLoading ? <Loader2 className="animate-spin" /> : <Lightbulb />}
                        <span>{isLoading ? 'Generating...' : 'Generate'}</span>
                    </button>
                </div>
                    <div className="min-h-[200px]">
                    {isLoading ? <LoadingSpinner message="Brainstorming ideas..." /> : (
                        <ul className="space-y-2">
                            {ideas.map((idea, index) => (
                                <li key={index} className="flex justify-between items-center p-3 bg-[#003366]/50 rounded-lg transition-transform duration-200 ease-in-out hover:-translate-y-1 hover:bg-[#003366]">
                                    <span className="text-gray-300">{idea}</span>
                                    <button onClick={() => handleStartWriting(idea)} className="text-xs font-semibold text-[#D4AF37] hover:text-yellow-200">Start Writing</button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </Modal>
    );
};
const SeriesIdeaGeneratorModal = ({ onClose, onCreateProject, setModal }) => {
    const [topic, setTopic] = useState('');
    const [seriesLength, setSeriesLength] = useState('mini');
    const [ideas, setIdeas] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const handleGenerate = async () => {
        setIsLoading(true);
        setIdeas([]);
        const lengthText = seriesLength === 'mini' ? '3-5' : '6-12';
        const prompt = `Brainstorm a list of 3-4 series ideas based on the topic: "${topic}". Each series should have ${lengthText} parts. For each idea, provide a compelling series title and a brief, one-sentence concept description. The target audience is interested in Ethiopian Orthodox Tewahedo theology. The response must be in JSON format.`;
        const schema = { type: "OBJECT", properties: { ideas: { type: "ARRAY", items: { type: "OBJECT", properties: { title: { type: "STRING" }, concept: { type: "STRING" } } } } } };

        try {
            const result = await callGemini(prompt, schema);
            const parsed = JSON.parse(result);
            setIdeas(parsed.ideas || []);
        } catch (error) {
            console.error("Series idea generation error:", error);
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to generate series ideas: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
        } finally {
            setIsLoading(false);
        }
    };

    const handleStartWriting = (title) => {
        onCreateProject('series', title);
        onClose();
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">✨ Series Idea Generator</h3>
                        <p className="text-gray-400 text-sm">Get inspired with AI-generated series concepts.</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                <div className="space-y-4 mb-4">
                    <input type="text" value={topic} onChange={e => setTopic(e.target.value)} placeholder="Enter a broad topic, e.g., 'The Desert Fathers'" className="w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]" />
                    <div className="flex items-center justify-center gap-4">
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                            <input type="radio" name="seriesLength" value="mini" checked={seriesLength === 'mini'} onChange={() => setSeriesLength('mini')} className="form-radio bg-gray-700 border-gray-600 text-[#D4AF37] focus:ring-[#D4AF37]"/>
                            Mini Series (3-5 Parts)
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                            <input type="radio" name="seriesLength" value="long" checked={seriesLength === 'long'} onChange={() => setSeriesLength('long')} className="form-radio bg-gray-700 border-gray-600 text-[#D4AF37] focus:ring-[#D4AF37]"/>
                            Long Series (6-12 Parts)
                        </label>
                    </div>
                    <button onClick={handleGenerate} disabled={isLoading || !topic} className="w-full md:w-auto px-6 py-2 font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 disabled:opacity-50 flex items-center justify-center gap-2">
                        {isLoading ? <Loader2 className="animate-spin" /> : <Lightbulb />}
                        <span>{isLoading ? 'Generating...' : 'Generate'}</span>
                    </button>
                </div>
                <div className="min-h-[200px]">
                    {isLoading ? <LoadingSpinner message="Brainstorming series ideas..." /> : (
                        <ul className="space-y-2">
                            {ideas.map((idea, index) => (
                                <li key={index} className="flex justify-between items-center p-3 bg-[#003366]/50 rounded-lg transition-transform duration-200 ease-in-out hover:-translate-y-1 hover:bg-[#003366]">
                                    <div>
                                        <h4 className="font-semibold text-[#D4AF37]">{idea.title}</h4>
                                        <p className="text-sm text-gray-300">{idea.concept}</p>
                                    </div>
                                    <button onClick={() => handleStartWriting(idea.title)} className="text-xs font-semibold text-[#D4AF37] hover:text-yellow-200 flex-shrink-0 ml-4">
                                        Start Series
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </Modal>
    );
};
const DevotionalIdeaGeneratorModal = ({ onClose, onCreateProject, setModal }) => {
    const categories = useMemo(() => [
        { id: 'season', name: 'Liturgical Season', placeholder: 'e.g., Great Lent' },
        { id: 'virtue', name: 'Virtue or Struggle', placeholder: 'e.g., Humility, Forgiveness' },
        { id: 'father', name: 'Church Father', placeholder: 'e.g., St. John Chrysostom' },
    ], []);
    const [category, setCategory] = useState(categories[0].id);
    const [input, setInput] = useState('');
    const [ideas, setIdeas] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const handleGenerate = async () => {
        setIsLoading(true);
        setIdeas([]);
        const selectedCategory = categories.find(c => c.id === category);
        const prompt = `Brainstorm a list of 5 titles for short devotional emails. The theme is based on the category "${selectedCategory.name}" with the specific input: "${input}". The tone should be pastoral and reflective. The response must be in JSON format.`;
        const schema = { type: "OBJECT", properties: { ideas: { type: "ARRAY", items: { type: "STRING" } } } };

        try {
            const result = await callGemini(prompt, schema);
            const parsed = JSON.parse(result);
            setIdeas(parsed.ideas || []);
        } catch (error) {
            console.error("Devotional idea generation error:", error);
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to generate devotional ideas: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleStartWriting = (title) => {
        onCreateProject('devotional', title);
        onClose();
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">✨ Devotional Idea Generator</h3>
                        <p className="text-gray-400 text-sm">Get inspired with AI-generated devotional topics.</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                <div className="flex flex-col md:flex-row items-center gap-2 mb-4">
                    <select value={category} onChange={e => setCategory(e.target.value)} className="w-full md:w-1/3 bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]">
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input type="text" value={input} onChange={e => setInput(e.target.value)} placeholder={categories.find(c => c.id === category)?.placeholder} className="flex-grow w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]" />
                    <button onClick={handleGenerate} disabled={isLoading || !input} className="w-full md:w-auto px-6 py-2 font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 disabled:opacity-50 flex items-center justify-center gap-2">
                        {isLoading ? <Loader2 className="animate-spin" /> : <Lightbulb />}
                        <span>{isLoading ? 'Generating...' : 'Generate'}</span>
                    </button>
                </div>
                    <div className="min-h-[200px]">
                    {isLoading ? <LoadingSpinner message="Brainstorming ideas..." /> : (
                        <ul className="space-y-2">
                            {ideas.map((idea, index) => (
                                <li key={index} className="flex justify-between items-center p-3 bg-[#003366]/50 rounded-lg transition-transform duration-200 ease-in-out hover:-translate-y-1 hover:bg-[#003366]">
                                    <span className="text-gray-300">{idea}</span>
                                    <button onClick={() => handleStartWriting(idea)} className="text-xs font-semibold text-[#D4AF37] hover:text-yellow-200">Start Writing</button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </Modal>
    );
};
const EbookIdeaGeneratorModal = ({ onClose, onCreateProject, setModal }) => {
    const [topic, setTopic] = useState('');
    const [ideas, setIdeas] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const handleGenerate = async () => {
        setIsLoading(true);
        setIdeas([]);
        const prompt = `Brainstorm a list of 3-4 e-book ideas based on the topic: "${topic}". For each idea, provide a compelling title and a short, one-paragraph synopsis. The target audience is interested in Ethiopian Orthodox Tewahedo theology. The response must be in JSON format.`;
        const schema = { type: "OBJECT", properties: { ideas: { type: "ARRAY", items: { type: "OBJECT", properties: { title: { type: "STRING" }, synopsis: { type: "STRING" } } } } } };

        try {
            const result = await callGemini(prompt, schema);
            const parsed = JSON.parse(result);
            setIdeas(parsed.ideas || []);
        } catch (error) {
            console.error("E-book idea generation error:", error);
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to generate e-book ideas: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
        } finally {
            setIsLoading(false);
        }
    };

    const handleStartWriting = (title) => {
        onCreateProject('ebooks', title);
        onClose();
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">✨ E-book Idea Generator</h3>
                        <p className="text-gray-400 text-sm">Get inspired with AI-generated e-book concepts.</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                <div className="flex items-center gap-2 mb-4">
                    <input type="text" value={topic} onChange={e => setTopic(e.target.value)} placeholder="Enter a broad topic, e.g., 'The Ark of the Covenant'" className="flex-grow w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]" />
                    <button onClick={handleGenerate} disabled={isLoading || !topic} className="px-6 py-2 font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 disabled:opacity-50 flex items-center justify-center gap-2">
                        {isLoading ? <Loader2 className="animate-spin" /> : <Lightbulb />}
                        <span>{isLoading ? 'Generating...' : 'Generate'}</span>
                    </button>
                </div>
                <div className="min-h-[200px]">
                    {isLoading ? <LoadingSpinner message="Brainstorming e-book ideas..." /> : (
                        <ul className="space-y-2">
                            {ideas.map((idea, index) => (
                                <li key={index} className="flex justify-between items-center p-3 bg-[#003366]/50 rounded-lg transition-transform duration-200 ease-in-out hover:-translate-y-1 hover:bg-[#003366]">
                                    <div>
                                        <h4 className="font-semibold text-[#D4AF37]">{idea.title}</h4>
                                        <p className="text-sm text-gray-300">{idea.synopsis}</p>
                                    </div>
                                    <button onClick={() => handleStartWriting(idea.title)} className="text-xs font-semibold text-[#D4AF37] hover:text-yellow-200 flex-shrink-0 ml-4">Start E-book</button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </Modal>
    );
};
const CourseIdeaGeneratorModal = ({ onClose, onCreateProject, setModal }) => {
    const [topic, setTopic] = useState('');
    const [level, setLevel] = useState('Beginner');
    const [ideas, setIdeas] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const handleGenerate = async () => {
        setIsLoading(true);
        setIdeas([]);
        const prompt = `Brainstorm a list of 3-4 course ideas based on the topic: "${topic}" for a "${level}" audience. For each idea, provide a compelling course title and a brief, one-sentence description. The target audience is interested in Ethiopian Orthodox Tewahedo theology. The response must be in JSON format.`;
        const schema = { type: "OBJECT", properties: { ideas: { type: "ARRAY", items: { type: "OBJECT", properties: { title: { type: "STRING" }, description: { type: "STRING" } } } } } };

        try {
            const result = await callGemini(prompt, schema);
            const parsed = JSON.parse(result);
            setIdeas(parsed.ideas || []);
        } catch (error) {
            console.error("Course idea generation error:", error);
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to generate course ideas: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
        } finally {
            setIsLoading(false);
        }
    };

    const handleStartWriting = (title) => {
        onCreateProject('courses', title);
        onClose();
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">✨ Course Idea Generator</h3>
                        <p className="text-gray-400 text-sm">Get inspired with AI-generated course concepts.</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                <div className="flex flex-col md:flex-row items-center gap-2 mb-4">
                    <input type="text" value={topic} onChange={e => setTopic(e.target.value)} placeholder="Enter a broad topic, e.g., 'The Lives of the Saints'" className="flex-grow w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]" />
                    <select value={level} onChange={e => setLevel(e.target.value)} className="w-full md:w-auto bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]">
                        <option>Beginner</option>
                        <option>Intermediate</option>
                        <option>Advanced</option>
                    </select>
                    <button onClick={handleGenerate} disabled={isLoading || !topic} className="w-full md:w-auto px-6 py-2 font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 disabled:opacity-50 flex items-center justify-center gap-2">
                        {isLoading ? <Loader2 className="animate-spin" /> : <Lightbulb />}
                        <span>{isLoading ? 'Generating...' : 'Generate'}</span>
                    </button>
                </div>
                <div className="min-h-[200px]">
                    {isLoading ? <LoadingSpinner message="Brainstorming course ideas..." /> : (
                        <ul className="space-y-2">
                            {ideas.map((idea, index) => (
                                <li key={index} className="flex justify-between items-center p-3 bg-[#003366]/50 rounded-lg transition-transform duration-200 ease-in-out hover:-translate-y-1 hover:bg-[#003366]">
                                    <div>
                                        <h4 className="font-semibold text-[#D4AF37]">{idea.title}</h4>
                                        <p className="text-sm text-gray-300">{idea.description}</p>
                                    </div>
                                    <button onClick={() => handleStartWriting(idea.title)} className="text-xs font-semibold text-[#D4AF37] hover:text-yellow-200 flex-shrink-0 ml-4">
                                        Start Course
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </Modal>
    );
};
const VideoIdeaGeneratorModal = ({ onClose, onCreateProject, setModal }) => {
    const [topic, setTopic] = useState('');
    const [ideas, setIdeas] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const handleGenerate = async () => {
        setIsLoading(true);
        setIdeas([]);
        const prompt = `Brainstorm a list of 3-4 video ideas based on the topic: "${topic}". For each idea, provide a compelling title, a suitable format (e.g., Short Explainer, Q&A, Documentary Style), and a brief, one-sentence description. The target audience is interested in Ethiopian Orthodox Tewahedo theology. The response must be in JSON format.`;
        const schema = { type: "OBJECT", properties: { ideas: { type: "ARRAY", items: { type: "OBJECT", properties: { title: { type: "STRING" }, format: { type: "STRING" }, description: { type: "STRING" } } } } } };

        try {
            const result = await callGemini(prompt, schema);
            const parsed = JSON.parse(result);
            setIdeas(parsed.ideas || []);
        } catch (error) {
            console.error("Video idea generation error:", error);
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to generate video ideas: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
        } finally {
            setIsLoading(false);
        }
    };

    const handleStartWriting = (title) => {
        onCreateProject('videos', title);
        onClose();
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">✨ Video Idea Generator</h3>
                        <p className="text-gray-400 text-sm">Get inspired with AI-generated video concepts.</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                <div className="flex items-center gap-2 mb-4">
                    <input type="text" value={topic} onChange={e => setTopic(e.target.value)} placeholder="Enter a broad topic, e.g., 'Orthodox Saints'" className="flex-grow w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]" />
                    <button onClick={handleGenerate} disabled={isLoading || !topic} className="px-6 py-2 font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 disabled:opacity-50 flex items-center justify-center gap-2">
                        {isLoading ? <Loader2 className="animate-spin" /> : <Lightbulb />}
                        <span>{isLoading ? 'Generating...' : 'Generate'}</span>
                    </button>
                </div>
                <div className="min-h-[200px]">
                    {isLoading ? <LoadingSpinner message="Brainstorming video ideas..." /> : (
                        <ul className="space-y-2">
                            {ideas.map((idea, index) => (
                                <li key={index} className="flex justify-between items-center p-3 bg-[#003366]/50 rounded-lg transition-transform duration-200 ease-in-out hover:-translate-y-1 hover:bg-[#003366]">
                                    <div>
                                        <h4 className="font-semibold text-[#D4AF37]">{idea.title}</h4>
                                        <p className="text-xs text-yellow-200 bg-yellow-900/50 inline-block px-2 py-0.5 rounded-full my-1">{idea.format}</p>
                                        <p className="text-sm text-gray-300">{idea.description}</p>
                                    </div>
                                    <button onClick={() => handleStartWriting(idea.title)} className="text-xs font-semibold text-[#D4AF37] hover:text-yellow-200 flex-shrink-0 ml-4">
                                        Start Script
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </Modal>
    );
};
const RepurposeModal = ({ contentToRepurpose, title, onClose, setModal, onCreateProject }) => {
    const [result, setResult] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedOption, setSelectedOption] = useState(null);

    const handleGenerate = async (option) => {
        setSelectedOption(option);
        setIsLoading(true);
        setResult(null);

        let prompt, schema, projectType;

        switch (option.id) {
            case 'discussionGuide':
                projectType = 'guide';
                prompt = `From the following text titled "${title}", create a small group discussion guide. The guide should be reverent and practical for a faith-based audience. The response must be in JSON format.\n\nText:\n${contentToRepurpose.substring(0, 3000)}`;
                schema = { type: "OBJECT", properties: { guideTitle: { type: "STRING" }, openingPrayer: { type: "STRING" }, discussionQuestions: { type: "ARRAY", items: { type: "STRING" } }, closingPrayer: { type: "STRING" } } };
                break;
            case 'socialSnippets':
                // This case is now handled by opening the SocialMediaModal directly.
                // The logic is kept here as a fallback, but the button will trigger the new modal.
                projectType = 'social';
                prompt = `Based on the following text titled "${title}", generate social media posts for Twitter, Instagram, and Facebook to promote it. The tone should be engaging and reverent, suitable for the "Ancient Truths, Modern Times" audience. The response must be in JSON format.\n\nText:\n${contentToRepurpose.substring(0, 2000)}`;
                schema = { type: "OBJECT", properties: { twitter: { type: "STRING" }, instagram: { type: "STRING" }, facebook: { type: "STRING" } }, required: ["twitter", "instagram", "facebook"] }; // Added required fields
                break;
            case 'podcastScript':
                projectType = 'podcast';
                prompt = `Convert the following article titled "${title}" into a conversational podcast script for "Ancient Truths, Modern Times". Include a brief musical intro/outro cue, a host introduction, a main body that's easy to read aloud, and a concluding summary. The response must be in JSON format.\n\nText:\n${contentToRepurpose.substring(0, 3000)}`;
                schema = { type: "OBJECT", properties: { scriptTitle: { type: "STRING" }, intro: { type: "STRING" }, mainScript: { type: "STRING" }, outro: { type: "STRING" } } };
                break;
            case 'slideDeck':
                projectType = 'deck';
                prompt = `Analyze the following text titled "${title}". Based on it, create a slide deck presentation. Your response **must** be a single, valid JSON object that strictly follows this structure: { "presentationTitle": "A title for the presentation", "slides": [ { "slideTitle": "Title for slide 1", "points": ["Point 1", "Point 2"], "speakerNotes": "Notes for the speaker on this slide." }, ... ] }. Do not include any text or formatting outside of this JSON object.\n\nText to analyze:\n${contentToRepurpose.substring(0, 3000)}`;
                schema = { type: "OBJECT", properties: { presentationTitle: { type: "STRING" }, slides: { type: "ARRAY", items: { type: "OBJECT", properties: { slideTitle: { type: "STRING" }, points: { type: "ARRAY", items: { type: "STRING" } }, speakerNotes: { type: "STRING" } }, required: ["slideTitle", "points", "speakerNotes"] } } } };
                break;
            case 'emailNewsletter':
                projectType = 'devotional';
                prompt = `You are an email marketer for "${BRAND_INFO.name}". Repurpose the following content titled "${title}" into an engaging email newsletter. The response must be a single, valid JSON object with "subject" and "body" keys. The body should include a personal greeting, a brief intro, the main content (formatted for readability with shorter paragraphs), and a concluding call-to-action or question. \n\nOriginal Text:\n${contentToRepurpose.substring(0, 3000)}`;
                schema = { type: "OBJECT", properties: { subject: { type: "STRING" }, body: { type: "STRING" } }, required: ["subject", "body"] };
                break;
            default:
                setIsLoading(false);
                return;
        }

        try {
            const apiResult = await callGemini(prompt, schema);
            setResult({ type: projectType, data: JSON.parse(apiResult) });
        } catch (error) {
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Could not generate ${option.title}.`} onClose={onClose} /> });
        } finally {
            setIsLoading(false);
        }
    };

    const createNewProjectFromResult = async () => {
        if (!result) return;
        let formattedContent, newTitle;
        
        switch (result.type) {
            case 'guide':
                newTitle = result.data.guideTitle;
                formattedContent = `# ${result.data.guideTitle}\n\n### Opening Prayer\n> ${result.data.openingPrayer}\n\n---\n\n### Discussion Questions\n${(result.data.discussionQuestions || []).map((q, i) => `${i + 1}. ${q}`).join('\n\n')}\n\n---\n\n### Closing Prayer\n> ${result.data.closingPrayer}`;
                break;
            case 'podcast':
                newTitle = result.data.scriptTitle;
                formattedContent = `# ${result.data.scriptTitle}\n\n**(Intro Music Cue)**\n\n### Introduction\n${result.data.intro}\n\n---\n\n### Main Script\n${result.data.mainScript}\n\n---\n\n### Conclusion\n${result.data.outro}\n\n**(Outro Music Cue)**`;
                break;
            case 'deck':
                newTitle = result.data.presentationTitle;
                formattedContent = `# ${result.data.presentationTitle}\n\n${(result.data.slides || []).map((slide, i) => `## Slide ${i+1}: ${slide.slideTitle}\n\n${(slide.points || []).map(p => `- ${p}`).join('\n')}\n\n**Speaker Notes:**\n*${slide.speakerNotes}*`).join('\n\n---\n\n')}`;
                break;
            case 'devotional':
                newTitle = result.data.subject;
                formattedContent = `Subject: ${result.data.subject}\n\n---\n\n${result.data.body}`;
                break;
            default: return;
        }
        
        await onCreateProject(result.type, newTitle, formattedContent);
        onClose();
    };

    const options = [
        { id: 'discussionGuide', title: 'Create Discussion Guide', description: 'Generate reflection questions for a group study.', icon: Users },
        { id: 'socialSnippets', title: 'Social Media Snippets', description: 'Extract quotes and highlights for social media.', icon: Share2 },
        { id: 'podcastScript', title: 'Podcast Script', description: 'Convert this text into a conversational audio script.', icon: Mic },
        { id: 'slideDeck', title: 'Slide Deck', description: 'Turn content into a presentation with speaker notes.', icon: Presentation },
        { id: 'emailNewsletter', title: 'Email Newsletter', description: 'Format this content as an engaging email.', icon: Mail },
    ];

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">✨ Repurpose Content</h3>
                        <p className="text-gray-400 text-sm">Turn your work into new formats with one click.</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                
                {isLoading && <LoadingSpinner message={`Generating ${selectedOption?.title}...`} />}

                {!isLoading && !result && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {options.map(opt => (
                            <button key={opt.id} onClick={() => opt.id === 'socialSnippets' ? setModal({isOpen: true, content: <SocialMediaModal contentToRepurpose={contentToRepurpose} title={title} onClose={onClose} setModal={setModal}/>}) : handleGenerate(opt)} className="w-full text-left p-4 bg-[#003366]/70 hover:bg-[#003366] rounded-lg transition-colors flex items-start gap-4">
                                <opt.icon className="h-6 w-6 text-[#D4AF37] mt-1 flex-shrink-0" />
                                <div>
                                    <h4 className="font-semibold text-white">{opt.title}</h4>
                                    <p className="text-sm text-gray-400">{opt.description}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                )}

                {!isLoading && result && (
                    <div>
                        {selectedOption?.id === 'slideDeck' ? (
                            <SlideDeckView title={result.data.presentationTitle} slides={result.data.slides} onClose={onClose} onCreateProject={onCreateProject} />
                        ) : (
                            <>
                                <h4 className="font-semibold text-lg text-white mb-2">Generated {selectedOption?.title}:</h4>
                                <div className="max-h-80 overflow-y-auto bg-[#001122]/50 p-4 rounded-lg border border-[#D4AF37]/20 whitespace-pre-wrap text-sm">
                                    <pre className="whitespace-pre-wrap font-sans">{JSON.stringify(result.data, null, 2)}</pre>
                                </div>
                                <div className="flex justify-end gap-3 mt-4">
                                    <button onClick={() => setResult(null)} className="px-4 py-2 text-sm font-semibold text-gray-300 bg-gray-700 rounded-lg hover:bg-gray-600">Back</button>
                                    <button onClick={createNewProjectFromResult} className="px-4 py-2 text-sm font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80">Save as New Project</button>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
};
const SlideDeckView = ({ title, slides, onClose, onCreateProject }) => {
    const slideDeckRef = useRef(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);

    const handleDownload = async () => {
        if (!html2pdf) {
            console.error('html2pdf.js is not loaded.');
            return;
        }

        setIsDownloading(true);
        try {
            const element = slideDeckRef.current;
            await html2pdf(element, {
                margin: 0.5,
                filename: `${title.replace(/ /g, '_')}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
            });
        } catch (error) {
            console.error('Error generating PDF:', error);
        } finally {
            setIsDownloading(false);
        }
    };
    
    // Use an effect to load the script if it's not present
    useEffect(() => {
        if (!html2pdf) {
            const script = document.createElement('script');
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
            script.async = true;
            document.body.appendChild(script);
            
            return () => {
                document.body.removeChild(script);
            };
        }
    }, []);

    const handleSave = async () => {
        const markdownContent = `# ${title}\n\n${slides.map((slide, index) => `## Slide ${index + 1}: ${slide.slideTitle}\n\n${slide.points.map(point => `- ${point}`).join('\n')}\n\n**Speaker Notes:**\n*${slide.speakerNotes}*`).join('\n\n---\n\n')}`;
        await onCreateProject('presentation', title, markdownContent);
        onClose();
    };
    
    const totalSlides = slides?.length || 0;

    return (
        <div className="flex flex-col h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white mb-1">Generated Slide Deck</h3>
                <div className="flex gap-2">
                    <button onClick={handleSave} className="px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 flex items-center gap-2">
                        <Save size={16} /> Save as Project
                    </button>
                    <button onClick={handleDownload} disabled={isDownloading || !html2pdf} className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                        {isDownloading ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
                        <span>{isDownloading ? 'Downloading...' : 'Download as PDF'}</span>
                    </button>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                
                <div className="flex-grow flex items-center justify-center relative p-4 bg-[#001122]/50 rounded-lg border border-[#D4AF37]/20">
                    {/* Presentation slides container for html2pdf to capture */}
                    <div id="presentation-container" ref={slideDeckRef} className="w-full h-full flex flex-col items-center justify-center text-black bg-white rounded-lg p-8 shadow-lg">
                        {slides?.length > 0 ? (
                            <div className="w-full h-full flex flex-col p-4 justify-between" key={currentSlide}>
                                <div className="flex-1 overflow-y-auto">
                                    <h1 className="text-4xl font-bold text-center mb-6 text-[#003366]">{slides[currentSlide].slideTitle}</h1>
                                    <ul className="list-disc list-inside space-y-4 text-xl text-gray-800">
                                        {slides[currentSlide].points.map((point, i) => (
                                            <li key={i}>{point}</li>
                                        ))}
                                    </ul>
                                </div>
                                <div className="mt-8 text-sm text-center text-gray-500">
                                    <p>Speaker Notes: {slides[currentSlide].speakerNotes}</p>
                                </div>
                                <div className="mt-auto text-sm text-right text-gray-500">
                                    Slide {currentSlide + 1} of {totalSlides}
                                </div>
                            </div>
                        ) : (
                            <div className="text-center text-gray-400">No slides to display.</div>
                        )}
                    </div>
                    
                    {/* Navigation Buttons */}
                    {totalSlides > 1 && (
                        <>
                            <button
                                onClick={() => setCurrentSlide(prev => (prev - 1 + totalSlides) % totalSlides)}
                                className="absolute left-4 top-1/2 transform -translate-y-1/2 p-2 rounded-full bg-black/30 hover:bg-black/50 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                disabled={currentSlide === 0}
                            >
                                <ChevronLeft size={24} />
                            </button>
                            <button
                                onClick={() => setCurrentSlide(prev => (prev + 1) % totalSlides)}
                                className="absolute right-4 top-1/2 transform -translate-y-1/2 p-2 rounded-full bg-black/30 hover:bg-black/50 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                disabled={currentSlide === totalSlides - 1}
                            >
                                <ChevronRight size={24} />
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
const GeneratedPromptModal = ({ promptText, onClose, setModal }) => {
    const [currentPrompt, setCurrentPrompt] = useState(promptText);
    const [isLoading, setIsLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [aspectRatio, setAspectRatio] = useState('1:1'); // New state for aspect ratio
    const [numVariations, setNumVariations] = useState(1); // New state for number of variations

    const handleCopy = () => {
        const textArea = document.createElement("textarea");
        textArea.value = currentPrompt;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Fallback: Oops, unable to copy', err);
        }
        document.body.removeChild(textArea);
    };

    const handleGenerateImage = async () => {
        setIsLoading(true);
        try {
            const generatedImageUrls = [];
            for (let i = 0; i < numVariations; i++) {
                const base64Data = await callImagen(currentPrompt, aspectRatio);
                generatedImageUrls.push(`data:image/png;base64,${base64Data}`);
            }
            
            setModal({
                isOpen: true,
                content: <GeneratedImageVariationsModal 
                    imageUrls={generatedImageUrls} 
                    prompt={currentPrompt} 
                    onClose={() => setModal({isOpen: false, content: null})} 
                    setModal={setModal} // Pass setModal here
                    onGenerateMore={() => { // Pass a function to generate more variations
                        setModal({ // Re-open this modal with current settings
                            isOpen: true,
                            content: <GeneratedPromptModal 
                                promptText={currentPrompt} 
                                onClose={() => setModal({isOpen: false, content: null})} 
                                setModal={setModal}
                            />
                        });
                    }}
                />
            });
        } catch (error) {
            setModal({
                isOpen: true, 
                content: <GeneratedImageVariationsModal 
                    error={error.message}
                    prompt={currentPrompt}
                    onClose={() => setModal({isOpen: false, content: null})} 
                    setModal={setModal} 
                /> 
            });
        } finally {
            setIsLoading(false);
        }
    };
    
    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">Generated Image Prompt</h3>
                        <p className="text-gray-400 text-sm">Review, edit, and use this prompt to generate an image.</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                <textarea
                    value={currentPrompt}
                    onChange={(e) => setCurrentPrompt(e.target.value)}
                    className="w-full h-40 p-3 bg-[#003366]/50 text-gray-300 rounded-lg border border-[#D4AF37]/30 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] resize-y leading-relaxed"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div>
                        <label htmlFor="aspect-ratio" className="block text-sm font-medium text-gray-300 mb-1">Aspect Ratio</label>
                        <select
                            id="aspect-ratio"
                            value={aspectRatio}
                            onChange={(e) => setAspectRatio(e.target.value)}
                            className="w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                        >
                            <option value="1:1">1:1 (Square)</option>
                            <option value="16:9">16:9 (Landscape)</option>
                            <option value="9:16">9:16 (Portrait)</option>
                            <option value="4:3">4:3 (Classic)</option>
                            <option value="3:4">3:4 (Tall)</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="num-variations" className="block text-sm font-medium text-gray-300 mb-1">Number of Variations</label>
                        <input
                            type="number"
                            id="num-variations"
                            value={numVariations}
                            onChange={(e) => setNumVariations(Math.max(1, Math.min(4, parseInt(e.target.value) || 1)))} // Limit 1-4
                            min="1"
                            max="4"
                            className="w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                        />
                    </div>
                </div>
                <div className="flex justify-end gap-3 mt-4">
                    <button onClick={handleCopy} className="px-4 py-2 text-sm font-semibold text-gray-300 bg-gray-700 rounded-lg hover:bg-gray-600 flex items-center gap-2">
                        {copied ? <CheckCircle size={16} /> : <ClipboardCopy size={16} />}
                        <span>{copied ? 'Copied!' : 'Copy'}</span>
                    </button>
                    <button onClick={handleGenerateImage} disabled={isLoading} className="px-4 py-2 text-sm font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 disabled:opacity-50 flex items-center gap-2">
                        {isLoading ? <Loader2 className="animate-spin" size={16} /> : <ImageIcon size={16} />}
                        <span>{isLoading ? 'Generating...' : 'Generate Image'}</span>
                    </button>
                </div>
            </div>
        </Modal>
    );
};
const SaveFromChatModal = ({ content, handleCreateNewProject, onClose }) => {
    const [title, setTitle] = useState('');
    const [type, setType] = useState('devotional');
    const [isLoading, setIsLoading] = useState(true);
    const [editedContent, setEditedContent] = useState('');

    useEffect(() => {
        const generateTitleAndSummary = async () => {
            setIsLoading(true);
            const prompt = `You are an expert editor. Read the following text from a theological Q&A. Your task is to extract the core information and present it as a new piece of content. The response must be a single, valid JSON object with two keys: "title" and "content". For the "title", create a concise, descriptive title based on the main subject. For the "content", write a clean, well-structured summary or detailed explanation of the answer, formatted in markdown.\n\nOriginal Text:\n${content}`;
            const schema = { type: "OBJECT", properties: { title: { type: "STRING" }, content: { type: "STRING" } }, required: ["title", "content"] };
            
            try {
                const result = await callGemini(prompt, schema);
                const parsed = JSON.parse(result);
                setTitle(parsed.title || 'New Project from Chat');
                setEditedContent(parsed.content || content);
            } catch (error) {
                console.error("Smart Save generation error:", error);
                // Fallback to simpler title generation if AI fails
                setTitle(content.split(' ').slice(0, 5).join(' ') + '...');
                setEditedContent(content);
            } finally {
                setIsLoading(false);
            }
        };

        generateTitleAndSummary();
    }, [content]);

    const handleSave = async () => {
        if (!title) return;
        await handleCreateNewProject(type, title, editedContent);
        onClose();
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">Save as New Project</h3>
                        <p className="text-gray-400 text-sm">Save this wisdom as a starting point for new content.</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                {isLoading ? <LoadingSpinner message="Preparing your content..." /> : (
                    <>
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm font-medium text-gray-300 mb-1 block">Project Title</label>
                                <input 
                                    type="text" 
                                    value={title} 
                                    onChange={(e) => setTitle(e.target.value)} 
                                    className="w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-300 mb-1 block">Content Type</label>
                                <select value={type} onChange={e => setType(e.target.value)} className="w-full bg-[#003366] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]">
                                    <option value="devotional">Devotional</option>
                                    <option value="blog">Blog Post</option>
                                    <option value="sermon">Sermon</option>
                                    <option value="series">Series</option>
                                    <option value="podcast">Podcast</option>
                                    <option value="ebooks">E-book</option>
                                    <option value="courses">Course</option>
                                    <option value="videos">Video</option>
                                    <option value="lyrics">Lyrics</option>
                                    <option value="guide">Discussion Guide</option>
                                    <option value="presentation">Presentation</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-300 mb-1 block">Content</label>
                                <textarea
                                    value={editedContent}
                                    onChange={(e) => setEditedContent(e.target.value)}
                                    className="w-full h-32 p-3 bg-[#003366] border border-[#D4AF37]/30 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37] resize-y"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-300 bg-gray-700 rounded-lg hover:bg-gray-600">Cancel</button>
                            <button onClick={handleSave} className="px-4 py-2 text-sm font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80">Save Project</button>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
};

// --- NEW CHAT MODAL ---
const AskTheFathersModal = ({ onClose, setModal, handleCreateNewProject }) => {
    const [messages, setMessages] = useState([
        { role: 'assistant', text: "Peace be with you. I am here to offer wisdom from the Holy Fathers of the Church. How may I help your spiritual journey today?" }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const newMessages = [...messages, { role: 'user', text: input }];
        setMessages(newMessages);
        setInput('');
        setIsLoading(true);

        const systemPrompt = "You are a helpful assistant knowledgeable in the writings of the Early Church Fathers and the traditions of the Ethiopian Orthodox Tewahedo Church. Your name is 'The Patristic Guide'. Answer the user's questions with wisdom, clarity, and reverence, often referencing patristic thought and scripture. Maintain a pastoral and encouraging tone. Do not break character.";
        const fullPrompt = `${systemPrompt}\n\n${newMessages.map(m => `${m.role}: ${m.text}`).join('\n')}\nassistant:`;

        try {
            const response = await callGemini(fullPrompt);
            setMessages(prev => [...prev, { role: 'assistant', text: response }]);
        } catch (error) {
            setMessages(prev => [...prev, { role: 'assistant', text: "I am sorry, but I encountered an error and cannot respond at this moment. Please try again later." }]);
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to get a response: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6 h-[80vh] flex flex-col">
                <div className="flex items-start justify-between mb-4 flex-shrink-0">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">✨ Ask the Fathers</h3>
                        <p className="text-gray-400 text-sm">A digital guide inspired by the wisdom of the Saints.</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>
                <div className="flex-grow bg-[#003366]/50 rounded-lg border border-[#D4AF37]/20 flex flex-col p-4 overflow-hidden">
                    <div className="flex-grow overflow-y-auto pr-2 space-y-4">
                        {messages.map((msg, index) => {
                            if (msg.role === 'user') {
                                return (
                                    <div key={index} className="flex items-end gap-2 justify-end">
                                        <div className="max-w-lg px-4 py-2 rounded-2xl bg-[#800020] text-white rounded-br-none">
                                            <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                                        </div>
                                    </div>
                                );
                            } else { // Assistant's message
                                return (
                                    <div key={index} className="flex items-start gap-2 justify-start">
                                        <div className="flex-shrink-0 self-start h-8 w-8 rounded-full bg-[#D4AF37] flex items-center justify-center text-[#003366] font-bold">A</div>
                                        <div className="flex items-end gap-2">
                                            <div className="max-w-lg px-4 py-2 rounded-2xl bg-[#002244] text-gray-300 rounded-bl-none">
                                                <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                                            </div>
                                            <AssistantMessageToolbar 
                                                messageText={msg.text} 
                                                setModal={setModal} 
                                                handleCreateNewProject={handleCreateNewProject}
                                            />
                                        </div>
                                    </div>
                                );
                            }
                        })}
                        {isLoading && (
                            <div className="flex items-end gap-2 justify-start">
                                <div className="flex-shrink-0 h-8 w-8 rounded-full bg-[#D4AF37] flex items-center justify-center text-[#003366] font-bold">A</div>
                                <div className="max-w-lg px-4 py-2 rounded-2xl bg-[#002244] text-gray-300 rounded-bl-none">
                                    <Loader2 className="animate-spin" size={20} />
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                    <form onSubmit={handleSendMessage} className="flex-shrink-0 flex items-center gap-2 pt-4 mt-4 border-t border-[#D4AF37]/20">
                        <input
                            type="text"
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            placeholder="Ask a question about faith, scripture, or life..."
                            className="flex-grow bg-[#002244] border border-[#D4AF37]/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                        />
                        <button type="submit" disabled={isLoading || !input.trim()} className="p-2 bg-[#800020] rounded-lg hover:bg-[#800020]/80 disabled:bg-opacity-50 disabled:cursor-not-allowed">
                            <Send size={20} className="text-white" />
                        </button>
                    </form>
                </div>
            </div>
        </Modal>
    );
};

const AssistantMessageToolbar = ({ messageText, setModal, handleCreateNewProject }) => {
    const [copyMenuOpen, setCopyMenuOpen] = useState(false);
    const [copyStatus, setCopyStatus] = useState(''); // '', 'loading', 'copied'
    const menuRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setCopyMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleSmartCopy = async (type) => {
        setCopyStatus('loading');
        setCopyMenuOpen(false);
        let prompt;
        switch(type) {
            case 'quote':
                prompt = `Format the following text as a blockquote, attributed to 'The Patristic Guide':\n\n${messageText}`;
                break;
            case 'summary':
                prompt = `Summarize the following text into a single, concise paragraph:\n\n${messageText}`;
                break;
            case 'quora':
                prompt = `You are an expert at formatting content for the platform Quora. Your task is to take the following theological explanation and reformat it as a clear, well-structured, and engaging Quora answer.
                
**CRITICAL INSTRUCTIONS:**
1. The answer **must strictly adhere to the theology of the Ethiopian Orthodox Tewahedo Church** and the broader Oriental Orthodox tradition. If the topic involves a point where this tradition differs from other Christian traditions (e.g., Christology), briefly and respectfully clarify that distinction.
2. In the main body of the answer, ensure you connect the key theological points back to their **scriptural roots or the teachings of the Early Church Fathers**.
3. At the beginning of the answer, provide a **new and fresh welcoming statement** that varies each time. Do not use the same opening phrase repeatedly.
4. At the end of the answer, add a section titled '**For Further Reading**' and suggest one relevant book, scriptural passage, or Church Father that discusses this topic.

**STRUCTURE:**
The answer should start with a direct response to a likely question, followed by the detailed explanation (incorporating the points above), and end with a concise summary. Use markdown for formatting, such as bolding and bullet points, to improve readability.

**Original Text to Format:**
${messageText}`;
                break;
            default: // full text
                prompt = messageText;
        }

        try {
            const textToCopy = (type === 'full') ? prompt : await callGemini(prompt);

            if (type === 'quora') {
                setModal({
                    isOpen: true,
                    content: <FormattedContentModal
                        title="Formatted for Quora"
                        content={textToCopy}
                        onClose={() => setModal({isOpen: false, content: null})}
                    />
                });
                setCopyStatus('');
            } else {
                const textArea = document.createElement("textarea");
                textArea.value = textToCopy;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                setCopyStatus('copied');
                setTimeout(() => setCopyStatus(''), 2000);
            }
        } catch (error) {
            setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Could not process content: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
            setCopyStatus('');
        }
    };

    const handleSaveAsProject = () => {
        setModal({
            isOpen: true,
            content: <SaveFromChatModal 
                content={messageText} 
                handleCreateNewProject={handleCreateNewProject} 
                onClose={() => setModal({isOpen: false, content: null})} 
            />
        });
        setCopyMenuOpen(false);
    };

    const renderCopyIcon = () => {
        if (copyStatus === 'loading') {
            return <Loader2 size={16} className="animate-spin text-yellow-400" />;
        }
        if (copyStatus === 'copied') {
            return <CheckCircle size={16} className="text-green-400" />;
        }
        return <ClipboardCopy size={16} />;
    };

    return (
        <div ref={menuRef} className="relative flex items-center gap-1 self-end mb-1">
            {/* Copy Button with Dropdown */}
            <div className="relative">
                <button 
                    onClick={() => setCopyMenuOpen(!copyMenuOpen)} 
                    className="p-1.5 rounded-full text-gray-400 hover:bg-[#003366] hover:text-white transition-colors"
                    title="Copy options"
                >
                    {renderCopyIcon()}
                </button>
                {copyMenuOpen && (
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-[#002244] border border-[#D4AF37]/30 rounded-lg shadow-lg z-10 w-48 animate-fade-in-fast">
                        <div className="p-1">
                            <button onClick={() => handleSmartCopy('full')} className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:bg-[#800020]/50 rounded-md">
                                <ClipboardIcon size={14} /> Copy Full Text
                            </button>
                            <button onClick={() => handleSmartCopy('summary')} className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:bg-[#800020]/50 rounded-md">
                                <Sparkles size={14} /> Copy Summary
                            </button>
                            <button onClick={() => handleSmartCopy('quote')} className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:bg-[#800020]/50 rounded-md">
                                <MessageSquareQuote size={14} /> Copy as Quote
                            </button>
                            <button onClick={() => handleSmartCopy('quora')} className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:bg-[#800020]/50 rounded-md">
                                <MessageSquareQuote size={14} /> Format for Quora
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Save Button */}
            <button 
                onClick={handleSaveAsProject} 
                className="p-1.5 rounded-full text-gray-400 hover:bg-[#003366] hover:text-white transition-colors"
                title="Save as new project"
            >
                <PlusCircle size={16} />
            </button>
        </div>
    );
};

const BookRecommendationsModal = ({ topicOrContent, onClose }) => {
    const [recommendedBooks, setRecommendedBooks] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchBooks = async () => {
            setIsLoading(true);
            const books = await getRecommendedBooks(topicOrContent);
            setRecommendedBooks(books);
            setIsLoading(false);
        };
        fetchBooks();
    }, [topicOrContent]);

    return (
        <Modal onClose={onClose}>
            <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">✨ Recommended Books</h3>
                        <p className="text-gray-400 text-sm">For further reading on this topic.</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20} /></button>
                </div>

                {isLoading ? (
                    <LoadingSpinner message="Finding book recommendations..." />
                ) : (
                    <>
                        {recommendedBooks.length > 0 ? (
                            <ul className="list-disc list-inside text-sm text-gray-300 space-y-2 max-h-80 overflow-y-auto">
                                {recommendedBooks.map((book, index) => (
                                    <li key={index}>
                                        <span className="font-semibold text-[#D4AF37]">"{book.title}"</span> by {book.author}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="text-center py-8 bg-[#002244]/50 rounded-lg border border-[#D4AF37]/20 border-dashed">
                                <p className="text-gray-400">No specific book recommendations found at this time. Try refining your content or topic.</p>
                            </div>
                        )}
                        <div className="flex justify-end mt-4">
                            <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80">Close</button>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
};

// --- NEW VISUAL INSIGHTS MODAL ---
const VisualInsightsModal = ({ onClose, setModal, handleCreateNewProject }) => {
    const [selectedFile, setSelectedFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [analysis, setAnalysis] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (file && (file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/jpg')) {
            setSelectedFile(file);
            setPreviewUrl(URL.createObjectURL(file));
            setAnalysis(''); // Clear previous analysis
        } else {
            setSelectedFile(null);
            setPreviewUrl(null);
            setAnalysis('');
            setModal({ isOpen: true, content: <AlertModal title="Invalid File Type" message="Please upload a JPG, JPEG, or PNG image file." onClose={() => setModal({isOpen: false, content: null})} /> });
        }
    };

    const handleAnalyzeImage = async () => {
        if (!selectedFile) {
            setModal({ isOpen: true, content: <AlertModal title="No Image" message="Please select an image to analyze." onClose={() => setModal({isOpen: false, content: null})} /> });
            return;
        }

        setIsLoading(true);
        setAnalysis('');

        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64Data = reader.result.split(',')[1];
            const mimeType = selectedFile.type;
            const prompt = `You are an art historian and theologian specializing in Ethiopian Orthodox Tewahedo iconography and sacred art. Analyze the uploaded image. Provide a detailed description of the iconography, its theological meaning, and any relevant historical or liturgical context within the Ethiopian Orthodox Tewahedo tradition. If it's not explicitly Orthodox iconography, interpret it from a general Christian sacred art perspective. Format your response in markdown, including sections for "Visual Description", "Theological Interpretation", and "Context/Significance".`;

            try {
                const result = await callGeminiVision(prompt, base64Data, mimeType);
                setAnalysis(result);
            } catch (error) {
                console.error("Image analysis error:", error);
                setModal({ isOpen: true, content: <AlertModal title="AI Error" message={`Failed to analyze image: ${error.message}`} onClose={() => setModal({isOpen: false, content: null})} /> });
            } finally {
                setIsLoading(false);
            }
        };
        reader.readAsDataURL(selectedFile);
    };

    const handleSaveAnalysis = async () => {
        if (!analysis) return;
        const title = `Visual Insight: ${selectedFile ? selectedFile.name : 'Untitled Image'}`;
        await handleCreateNewProject('blog', title, analysis); // Saving as a blog post
        onClose();
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6 h-[80vh] flex flex-col">
                <div className="flex items-start justify-between mb-4 flex-shrink-0">
                    <div>
                        <h3 className="text-lg font-bold text-white mb-1">✨ Visual Insights</h3>
                        <p className="text-gray-400 text-sm">Upload an image for theological and artistic analysis.</p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-[#003366]/50"><X size={20}/></button>
                </div>

                <div className="flex-grow flex flex-col items-center justify-center bg-[#003366]/50 rounded-lg border border-[#D4AF37]/20 p-4 overflow-hidden">
                    {!previewUrl && (
                        <div className="text-center py-8">
                            <ImageIcon size={48} className="text-gray-400 mb-4" />
                            <p className="text-gray-300">Upload an image to get started.</p>
                        </div>
                    )}
                    {previewUrl && (
                        <div className="flex-shrink-0 mb-4 max-h-64 max-w-full overflow-hidden rounded-lg border border-[#D4AF37]/20">
                            <img src={previewUrl} alt="Preview" className="object-contain w-full h-full" />
                        </div>
                    )}

                    <input
                        type="file"
                        accept="image/jpeg, image/png, image/jpg"
                        onChange={handleFileChange}
                        className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-[#800020] file:text-white hover:file:bg-[#800020]/80 cursor-pointer"
                    />

                    <button
                        onClick={handleAnalyzeImage}
                        disabled={!selectedFile || isLoading}
                        className="mt-4 w-full px-6 py-2 font-semibold text-white bg-[#D4AF37] rounded-lg hover:bg-[#D4AF37]/80 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                    >
                        {isLoading ? <Loader2 className="animate-spin" /> : <Sparkles />}
                        <span>{isLoading ? 'Analyzing...' : 'Analyze Image'}</span>
                    </button>

                    {analysis && (
                        <div className="mt-4 flex-grow w-full overflow-y-auto bg-[#002244]/50 p-4 rounded-lg border border-[#D4AF37]/20">
                            <h4 className="font-semibold text-[#D4AF37] mb-2">AI Analysis:</h4>
                            <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap text-gray-300" dangerouslySetInnerHTML={{ __html: marked.parse(analysis) }} />
                        </div>
                    )}
                </div>

                {analysis && !isLoading && (
                    <div className="flex justify-end mt-4 flex-shrink-0">
                        <button onClick={handleSaveAnalysis} className="px-4 py-2 text-sm font-semibold text-white bg-[#800020] rounded-lg hover:bg-[#800020]/80 flex items-center gap-2">
                            <Save size={16} /> Save Analysis as Project
                        </button>
                    </div>
                )}
            </div>
        </Modal>
    );
};
