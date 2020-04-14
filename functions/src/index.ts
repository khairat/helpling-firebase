import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'

admin.initializeApp(functions.config().firebase)

const removeComments = async (itemId: string): Promise<void> => {
  const docs = await admin
    .firestore()
    .collection('comments')
    .where('itemId', '==', itemId)
    .get()

  const batch = admin.firestore().batch()

  docs.forEach(({ ref }) => batch.delete(ref))

  await batch.commit()
}

export const accept = functions.https.onCall(async ({ id, kind }, { auth }) => {
  if (!auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Need to be authenticated.'
    )
  }

  const collection = kind === 'offer' ? 'offers' : 'requests'

  const item = await admin.firestore().collection(collection).doc(id).get()

  const data = item.data()

  if (!data) {
    throw new functions.https.HttpsError(
      'not-found',
      `${kind === 'offer' ? 'Offer' : 'Request'} not found.`
    )
  }

  const { status, userId } = data

  if (status !== 'pending') {
    throw new functions.https.HttpsError(
      'already-exists',
      `${kind === 'offer' ? 'Offer' : 'Request'} already accepted.`
    )
  }

  if (auth.uid === userId) {
    throw new functions.https.HttpsError(
      'permission-denied',
      `You cannot accept your own ${kind}.`
    )
  }

  const thread = await admin
    .firestore()
    .collection('threads')
    .add({
      createdAt: new Date(),
      itemId: item.id,
      updatedAt: new Date(),
      userIds: [userId, auth.uid]
    })

  await admin.firestore().collection(collection).doc(id).update({
    helplingId: auth.uid,
    status: 'accepted',
    threadId: thread.id,
    updatedAt: new Date()
  })
})

export const removeCommentsOnOfferRemove = functions.firestore
  .document('offers/{id}')
  .onDelete((doc) => removeComments(doc.id))

export const removeCommentsOnRequestRemove = functions.firestore
  .document('requests/{id}')
  .onDelete((doc) => removeComments(doc.id))

export const updateThreadOnMessageCreate = functions.firestore
  .document('messages/{id}')
  .onCreate(async (doc) => {
    const data = doc.data()

    if (data) {
      const { threadId } = data

      await admin.firestore().collection('threads').doc(threadId).update({
        updatedAt: new Date()
      })
    }
  })
