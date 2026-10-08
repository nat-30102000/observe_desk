const api = globalThis.browser ?? globalThis.chrome;
const input = document.getElementById('token');
api.storage.local.get('token').then(({ token }) => { if (token) input.value = token; });
document.getElementById('save').addEventListener('click', async () => {
  await api.storage.local.set({ token: input.value.trim() });
  document.getElementById('msg').textContent = 'Saved.';
});
