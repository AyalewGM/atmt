import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, doc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { appId, firebaseConfig } from '../config/constants';

export class FirebaseService {
  constructor() {
    this.app = null;
    this.auth = null;
    this.db = null;
    this.storage = null;
  }

  init() {
    if (this.app) return; // idempotent
    const app = initializeApp(firebaseConfig);
    this.app = app;
    this.auth = getAuth(app);
    this.db = getFirestore(app);
    this.storage = getStorage(app);
  }

  watchAuth({ onReady, onUser }) {
    if (!this.auth) this.init();
    return onAuthStateChanged(this.auth, async (user) => {
      if (user) {
        onUser?.(user);
      } else {
        try {
          // eslint-disable-next-line no-undef
          if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            // eslint-disable-next-line no-undef
            await signInWithCustomToken(this.auth, __initial_auth_token);
          } else {
            await signInAnonymously(this.auth);
          }
        } catch (e) {
          console.error('Authentication Error:', e);
        }
      }
      onReady?.();
    });
  }

  projectsPath(userId) { return `artifacts/${appId}/users/${userId}/projects`; }
  scheduledPath(userId) { return `artifacts/${appId}/users/${userId}/scheduledPosts`; }

  listenProjects(userId, cb, onError) {
    const q = query(collection(this.db, this.projectsPath(userId)));
    return onSnapshot(q, (snapshot) => {
      const projects = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      projects.sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
      cb(projects);
    }, onError);
  }

  listenScheduled(userId, cb, onError) {
    const q = query(collection(this.db, this.scheduledPath(userId)));
    return onSnapshot(q, (snapshot) => {
      const posts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      cb(posts);
    }, onError);
  }

  async createProject(userId, { title, content, type }) {
    const data = { title, content, type, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    const ref = await addDoc(collection(this.db, this.projectsPath(userId)), data);
    return { id: ref.id, ...data, createdAt: new Date(), updatedAt: new Date() };
  }

  async updateProject(userId, projectId, data) {
    const ref = doc(this.db, this.projectsPath(userId), projectId);
    await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
  }

  async deleteProject(userId, projectId) {
    const ref = doc(this.db, this.projectsPath(userId), projectId);
    await deleteDoc(ref);
  }

  async schedulePost(userId, { projectId, projectTitle, platform, scheduleDate }) {
    const data = { projectId, projectTitle, platform, scheduleDate: Timestamp.fromDate(scheduleDate), status: 'scheduled' };
    await addDoc(collection(this.db, this.scheduledPath(userId)), data);
  }

  async updateScheduled(userId, postId, { projectId, projectTitle, platform, scheduleDate }) {
    const ref = doc(this.db, this.scheduledPath(userId), postId);
    await updateDoc(ref, { projectId, projectTitle, platform, scheduleDate: Timestamp.fromDate(scheduleDate) });
  }

  async deleteScheduled(userId, postId) {
    await deleteDoc(doc(this.db, this.scheduledPath(userId), postId));
  }
}

const firebaseService = new FirebaseService();
export default firebaseService;

