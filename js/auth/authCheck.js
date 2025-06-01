import { authService } from './../configFirebase.js';
export async function checkAuth() {
    const currentUser = await authService.getCurrentUser();
    if (!currentUser) {
        window.location.href = '../index.html';
        return false;
    }
    return true;
}