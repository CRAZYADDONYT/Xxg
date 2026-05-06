import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
const categories = ['Gaming', 'Music', 'Sports', 'Anime', 'Live', 'Technology', 'Trending', 'New'];
const allowedExt = ['mp4', 'mov', 'avi'];
const maxVideoBytes = 500 * 1024 * 1024;

const categoryBar = document.getElementById('categoryBar');
const grid = document.getElementById('videoGrid');
const searchInput = document.getElementById('searchInput');
const uploadDialog = document.getElementById('uploadDialog');
const uploadForm = document.getElementById('uploadForm');
const uploadProgress = document.getElementById('uploadProgress');
const uploadError = document.getElementById('uploadError');
const uploadStatus = document.getElementById('uploadStatus');
const videoFileInput = document.getElementById('videoFile');
const thumbnailInput = document.getElementById('thumbnailFile');
const dropZone = document.getElementById('dropZone');
const preview = document.getElementById('videoPreview');
const channelLabel = document.getElementById('channelLabel');

let selectedVideo = null;

const setError = (msg = '') => {
  uploadError.textContent = msg;
  uploadError.classList.toggle('hidden', !msg);
};

const validateVideo = (file) => {
  if (!file) return 'Please choose a video file.';
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!allowedExt.includes(ext)) return 'Only MP4, MOV, and AVI are allowed.';
  if (file.size > maxVideoBytes) return 'File exceeds 500MB limit.';
  return '';
};

function setSelectedVideo(file) {
  const error = validateVideo(file);
  if (error) {
    selectedVideo = null;
    preview.classList.add('hidden');
    preview.removeAttribute('src');
    setError(error);
    return;
  }

  selectedVideo = file;
  setError('');
  preview.src = URL.createObjectURL(file);
  preview.classList.remove('hidden');
  uploadStatus.textContent = `Ready: ${file.name}`;
}

categories.forEach((c) => {
  const b = document.createElement('button');
  b.className = 'cat';
  b.textContent = c;
  b.onclick = () => loadVideos(c);
  categoryBar.appendChild(b);
  document.getElementById('categoryInput').innerHTML += `<option>${c}</option>`;
});

function fmtViews(v) { return `${Number(v).toLocaleString()} views`; }

async function refreshAccount() {
  const res = await fetch('/api/account/session');
  const data = await res.json();
  channelLabel.textContent = data.channelName;
}

async function loadVideos(category = '') {
  const query = new URLSearchParams({ q: searchInput.value, category }).toString();
  const res = await fetch(`/api/videos?${query}`);
  const videos = await res.json();
  grid.innerHTML = videos.map((v) => `<article class="card" onclick="location.href='/player.html?id=${v.id}'"><div class="thumb-wrap"><img src="${v.thumbnail_url}" alt="thumbnail" /><span class="duration">${v.duration_label || '--:--'}</span></div><div class="card-body"><div class="title">${v.title}</div><div class="muted">${v.channel_name}</div><div class="muted">${fmtViews(v.views)} • ${v.time_ago}</div></div></article>`).join('');
}

searchInput.addEventListener('input', () => loadVideos());
document.getElementById('openUploadBtn').onclick = () => uploadDialog.showModal();
document.getElementById('closeUploadBtn').onclick = () => uploadDialog.close();

document.getElementById('profileBtn').onclick = async () => {
  const channelName = prompt('Enter your channel name');
  if (!channelName) return;
  const res = await fetch('/api/account/channel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelName }) });
  if (!res.ok) return alert('Could not save channel');
  await refreshAccount();
};

videoFileInput.addEventListener('change', () => setSelectedVideo(videoFileInput.files[0]));

dropZone.addEventListener('click', () => videoFileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragging'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragging');
  setSelectedVideo(e.dataTransfer.files[0]);
});

function uploadWithProgress(formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/videos/upload');
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      uploadProgress.value = Math.round((e.loaded / e.total) * 100);
      uploadStatus.textContent = `Uploading... ${uploadProgress.value}%`;
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else reject(new Error(JSON.parse(xhr.responseText).error || 'Upload failed'));
    };
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.send(formData);
  });
}

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('');
  uploadProgress.value = 0;

  const fileError = validateVideo(selectedVideo);
  if (fileError) return setError(fileError);
  if (!thumbnailInput.files[0]) return setError('Please add a thumbnail image.');

  const fd = new FormData();
  fd.append('videoFile', selectedVideo);
  fd.append('thumbnailFile', thumbnailInput.files[0]);
  fd.append('titleInput', document.getElementById('titleInput').value.trim());
  fd.append('descriptionInput', document.getElementById('descriptionInput').value.trim());
  fd.append('categoryInput', document.getElementById('categoryInput').value);

  try {
    await uploadWithProgress(fd);
    uploadStatus.textContent = 'Upload complete!';
    uploadForm.reset();
    selectedVideo = null;
    preview.classList.add('hidden');
    preview.removeAttribute('src');
    setTimeout(() => { uploadDialog.close(); uploadProgress.value = 0; uploadStatus.textContent = ''; }, 700);
    await loadVideos();
  } catch (err) {
    setError(err.message);
    uploadStatus.textContent = '';
  }
});

refreshAccount();
loadVideos();
